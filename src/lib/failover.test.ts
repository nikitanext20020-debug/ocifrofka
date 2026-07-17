import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithFailover } from "./recognition-queue";

// Mock the logs module to avoid actual app logging in tests
vi.mock("@/lib/app-logs", () => ({
  appendAppLog: vi.fn(),
}));

const agents = [
  { id: "agent-1", name: "Agent 1", baseUrl: "https://agent1.org", apiKey: "key1", model: "model1" },
  { id: "agent-2", name: "Agent 2", baseUrl: "https://agent2.org", apiKey: "key2", model: "model2" },
];

describe("fetchWithFailover", () => {
  beforeEach(() => {
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("switches to the second agent if the first one returns 429", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 })) // First agent try 1
      .mockResolvedValueOnce(new Response(null, { status: 429 })) // First agent try 2
      .mockResolvedValueOnce(new Response(null, { status: 429 })) // First agent try 3 (fails completely)
      .mockResolvedValueOnce(new Response("success", { status: 200 })); // Second agent try 1 (success)

    const response = await fetchWithFailover({
      agents,
      activeAgentId: "agent-1",
      timeoutSeconds: 5,
      path: "/api/test",
      method: "POST",
      body: "{}",
      area: "Test",
      action: "Test Action",
      fetcher,
    });

    expect(response.status).toBe(200);
    const bodyText = await response.text();
    expect(bodyText).toBe("success");
    // 3 tries on first agent + 1 try on second agent
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("switches to the second agent if the first one times out", async () => {
    const fetcher = vi.fn();
    // Simulate first agent taking 10 seconds (times out on 2 seconds limit)
    fetcher.mockImplementationOnce(async (url, options) => {
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          resolve(new Response("success-late", { status: 200 }));
        }, 10000);
        options.signal?.addEventListener("abort", () => {
          clearTimeout(timeoutId);
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    // Second agent succeeds immediately
    fetcher.mockResolvedValueOnce(new Response("success-fast", { status: 200 }));

    const response = await fetchWithFailover({
      agents,
      activeAgentId: "agent-1",
      timeoutSeconds: 1, // 1 second timeout
      path: "/api/test",
      method: "POST",
      body: "{}",
      area: "Test",
      action: "Test Action",
      fetcher,
    });

    expect(response.status).toBe(200);
    const bodyText = await response.text();
    expect(bodyText).toBe("success-fast");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("throws error with aggregated details when all agents fail", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));

    await expect(
      fetchWithFailover({
        agents,
        activeAgentId: "agent-1",
        timeoutSeconds: 2,
        path: "/api/test",
        method: "POST",
        body: "{}",
        area: "Test",
        action: "Test Action",
        fetcher,
      })
    ).rejects.toThrow("Все доступные агенты вернули ошибку");
  });
});
