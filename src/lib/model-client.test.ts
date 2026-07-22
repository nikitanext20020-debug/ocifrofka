import { afterEach, describe, expect, it } from "vitest";
import { readAgentConfig } from "./model-client";

const ENV_KEYS = [
  "TABLE_API_KEY_1",
  "TABLE_API_KEY_2",
  "TABLE_API_BASE_URL_2",
  "VISION_API_KEY_1",
];

function request(headers: Record<string, string>) {
  return new Request("https://example.test/api", { headers });
}

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("readAgentConfig server API keys", () => {
  it("prefers a client key when provided", () => {
    process.env.TABLE_API_KEY_1 = "server-secret";
    const config = readAgentConfig(request({
      "x-agent-base-url": "https://provider.test/v1",
      "x-agent-api-key": "client-secret",
      "x-agent-model": "model",
      "x-agent-index": "1",
    }), "table");

    expect(config.apiKey).toBe("client-secret");
  });

  it("falls back to a server key by agent number", () => {
    process.env.VISION_API_KEY_1 = "vision-secret";
    const config = readAgentConfig(request({
      "x-agent-base-url": "https://provider.test/v1",
      "x-agent-model": "model",
      "x-agent-index": "1",
    }), "vision");

    expect(config.apiKey).toBe("vision-secret");
  });

  it("matches a server key by base URL before agent number", () => {
    process.env.TABLE_API_KEY_1 = "index-secret";
    process.env.TABLE_API_KEY_2 = "url-secret";
    process.env.TABLE_API_BASE_URL_2 = "https://provider.test/v1/";
    const config = readAgentConfig(request({
      "x-agent-base-url": "https://provider.test/v1",
      "x-agent-model": "model",
      "x-agent-index": "1",
    }), "table");

    expect(config.apiKey).toBe("url-secret");
  });
});
