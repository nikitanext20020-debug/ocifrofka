import dns from "node:dns/promises";
import net from "node:net";
import type { ZodType } from "zod";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<Record<string, unknown>>;
};

type AgentRequestConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export class ModelApiError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "ModelApiError";
    this.status = status;
  }
}

function isPrivateIp(address: string) {
  if (net.isIPv4(address)) {
    const parts = address.split(".").map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    );
  }
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

async function validateBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ModelApiError("Некорректный base_url.", 400);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new ModelApiError("base_url должен быть публичным HTTPS-адресом.", 400);
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new ModelApiError("Локальные адреса нельзя использовать как base_url.", 400);
  }
  try {
    const addresses = net.isIP(hostname)
      ? [{ address: hostname }]
      : await dns.lookup(hostname, { all: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
      throw new ModelApiError("base_url ведёт на недоступный внутренний адрес.", 400);
    }
  } catch (error) {
    if (error instanceof ModelApiError) throw error;
    throw new ModelApiError("Не удалось найти сервер, указанный в base_url.", 400);
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/chat/completions`;
  url.search = "";
  url.hash = "";
  return url;
}

export function readAgentConfig(request: Request): AgentRequestConfig {
  const baseUrl = request.headers.get("x-agent-base-url")?.trim() ?? "";
  const apiKey = request.headers.get("x-agent-api-key")?.trim() ?? "";
  const model = request.headers.get("x-agent-model")?.trim() ?? "";
  if (!baseUrl || !apiKey || !model) {
    throw new ModelApiError(
      "Заполните base_url, API-ключ и ID модели в настройках.",
      400,
    );
  }
  return { baseUrl, apiKey, model };
}

function providerError(status: number, details?: string) {
  if (status === 400) return "Провайдер отклонил запрос. Проверьте модель и размер данных.";
  if (status === 401 || status === 403) return "API-ключ неверен или у него нет доступа к модели.";
  if (status === 413) return "Файл или запрос слишком большой. Уменьшите объём данных.";
  if (status === 429) return "Лимит запросов исчерпан. Подождите и повторите попытку.";
  if (status >= 500) return "Сервис модели временно недоступен. Повторите попытку позже.";
  return details ? `Ошибка провайдера: ${details}` : "Провайдер не смог обработать запрос.";
}

export function normalizeAssistantContent(content: unknown) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        const text = "text" in part ? part.text : "content" in part ? part.content : "";
        return typeof text === "string" ? text : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (content && typeof content === "object") return JSON.stringify(content);
  return "";
}

function findJsonBlock(content: string) {
  for (let start = 0; start < content.length; start += 1) {
    if (content[start] !== "{" && content[start] !== "[") continue;
    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    for (let index = start; index < content.length; index += 1) {
      const character = content[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === "{" || character === "[") {
        stack.push(character);
      } else if (character === "}" || character === "]") {
        const opening = stack.pop();
        const matches =
          (opening === "{" && character === "}") ||
          (opening === "[" && character === "]");
        if (!matches) break;
        if (stack.length === 0) return content.slice(start, index + 1);
      }
    }
  }
  return null;
}

export function parseJsonContent(content: string) {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const jsonBlock = findJsonBlock(trimmed);
    if (!jsonBlock) throw new SyntaxError("В ответе модели не найден JSON-объект.");
    return JSON.parse(jsonBlock) as unknown;
  }
}

async function requestCompletion(
  config: AgentRequestConfig,
  messages: ChatMessage[],
  jsonMode: boolean,
) {
  const endpoint = await validateBaseUrl(config.baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: jsonMode ? 0 : 0.2,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as {
      choices?: Array<{
        message?: {
          content?: unknown;
          reasoning_content?: unknown;
        };
      }>;
      error?: { message?: string } | string;
    } | null;
    if (!response.ok) {
      const details =
        typeof payload?.error === "string" ? payload.error : payload?.error?.message;
      throw new ModelApiError(providerError(response.status, details), response.status);
    }
    const message = payload?.choices?.[0]?.message;
    const content = normalizeAssistantContent(message?.content);
    const reasoning = normalizeAssistantContent(message?.reasoning_content);
    const result = content || reasoning;
    if (!result) throw new ModelApiError("Модель вернула пустой ответ.", 502);
    return result;
  } catch (error) {
    if (error instanceof ModelApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ModelApiError("Модель не ответила за 90 секунд.", 504);
    }
    throw new ModelApiError("Не удалось подключиться к сервису модели.", 502);
  } finally {
    clearTimeout(timeout);
  }
}

export async function callStructured<T>(options: {
  config: AgentRequestConfig;
  messages: ChatMessage[];
  schema: ZodType<T>;
}) {
  let lastError: unknown;
  let previousContent = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const messages: ChatMessage[] =
        attempt === 0
          ? options.messages
          : [
              ...options.messages,
              { role: "assistant", content: previousContent.slice(0, 12_000) },
              {
                role: "user",
                content:
                  "Исправь предыдущий ответ. Верни только валидный JSON строго по заданной структуре, без Markdown и пояснений.",
              },
            ];
      previousContent = await requestCompletion(options.config, messages, true);
      return options.schema.parse(parseJsonContent(previousContent));
    } catch (error) {
      if (error instanceof ModelApiError) throw error;
      lastError = error;
    }
  }
  const reason =
    lastError instanceof SyntaxError
      ? "ответ не содержит корректный JSON"
      : "поля ответа не соответствуют требуемой структуре";
  throw new ModelApiError(`Модель дважды вернула неверный формат: ${reason}.`, 502);
}

export async function testConnection(config: AgentRequestConfig) {
  const content = await requestCompletion(
    config,
    [{ role: "user", content: "Ответь одним словом: готово" }],
    false,
  );
  return content.trim();
}

export function apiError(error: unknown) {
  if (error instanceof ModelApiError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json(
    { error: "Внутренняя ошибка при обработке запроса." },
    { status: 500 },
  );
}
