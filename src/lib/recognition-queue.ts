export type PoolSettledResult<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown };

export async function runPromisePool<Item, Result>(options: {
  items: readonly Item[];
  concurrency: number;
  task: (item: Item, index: number) => Promise<Result>;
  onSettled?: (
    result: PoolSettledResult<Result>,
    item: Item,
    index: number,
  ) => void;
}) {
  const results = new Array<PoolSettledResult<Result>>(options.items.length);
  if (!options.items.length) return results;

  const concurrency = Math.min(
    options.items.length,
    Math.max(1, Math.floor(options.concurrency)),
  );
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < options.items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = options.items[index];
      let result: PoolSettledResult<Result>;
      try {
        result = { status: "fulfilled", value: await options.task(item, index) };
      } catch (reason) {
        result = { status: "rejected", reason };
      }
      results[index] = result;
      options.onSettled?.(result, item, index);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const wait = (delayMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export async function fetchWithRateLimitRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: {
    maxAttempts?: number;
    baseDelayMs?: number;
    fetcher?: FetchLike;
    wait?: (delayMs: number) => Promise<void>;
  } = {},
) {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 1_000);
  const fetcher = options.fetcher ?? fetch;
  const pause = options.wait ?? wait;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetcher(input, init);
    if (response.status !== 429 || attempt === maxAttempts - 1) {
      return response;
    }
    await pause(baseDelayMs * 2 ** attempt);
  }

  throw new Error("Не удалось выполнить запрос.");
}

export async function fetchWithFailover<
  Agent extends { id: string; name: string; baseUrl: string; apiKey: string; model: string }
>(options: {
  agents: Agent[];
  activeAgentId: string;
  timeoutSeconds: number;
  path: string;
  method: string;
  body: string;
  area: string;
  action: string;
  fetcher?: FetchLike;
}): Promise<Response> {
  const { appendAppLog } = await import("@/lib/app-logs");

  const agents = options.agents;
  const activeAgentId = options.activeAgentId;
  const timeoutSeconds = options.timeoutSeconds;
  const fetcher = options.fetcher ?? fetch;

  if (!agents || agents.length === 0) {
    throw new Error("Нет доступных агентов для выполнения запроса.");
  }

  const activeIndex = agents.findIndex((a) => a.id === activeAgentId);
  const startIndex = activeIndex >= 0 ? activeIndex : 0;
  const orderedAgents = [
    ...agents.slice(startIndex),
    ...agents.slice(0, startIndex),
  ];

  const errors: string[] = [];

  for (let i = 0; i < orderedAgents.length; i++) {
    const agent = orderedAgents[i];
    const attemptStart = Date.now();
    const controller = new AbortController();
    const timeoutMs = timeoutSeconds * 1000;
    const tId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers = {
        "Content-Type": "application/json",
        "x-agent-base-url": agent.baseUrl,
        "x-agent-api-key": agent.apiKey,
        "x-agent-model": agent.model,
      };

      const response = await fetchWithRateLimitRetry(
        options.path,
        {
          method: options.method,
          headers,
          body: options.body,
          signal: controller.signal,
        },
        { fetcher }
      );

      clearTimeout(tId);

      if (response.status === 429) {
        throw new Error("Превышен лимит запросов (429 после повторных попыток).");
      }
      if (response.status >= 500) {
        throw new Error(`Ошибка сервера провайдера (${response.status}).`);
      }

      return response;
    } catch (error) {
      clearTimeout(tId);
      const durationMs = Date.now() - attemptStart;
      const err = error as { name?: string; message?: string };
      const isTimeout = err?.name === "AbortError" || durationMs >= timeoutMs;
      const reason = isTimeout
        ? `превышен таймаут ${timeoutSeconds}с`
        : err?.message || String(error);

      errors.push(`${agent.name}: ${reason}`);

      if (i < orderedAgents.length - 1) {
        const nextAgent = orderedAgents[i + 1];
        appendAppLog({
          level: "warning",
          area: options.area,
          message: `Сбой агента «${agent.name}» (${reason}). Переключение на «${nextAgent.name}». Ожидание: ${(durationMs / 1000).toFixed(1)} сек.`,
          details: {
            failedAgent: agent.name,
            reason,
            nextAgent: nextAgent.name,
            waitSec: durationMs / 1000,
          },
        });
      }
    }
  }

  throw new Error(`Все доступные агенты вернули ошибку:\n${errors.join("\n")}`);
}

