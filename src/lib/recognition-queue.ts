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
