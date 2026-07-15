import { describe, expect, it, vi } from "vitest";
import {
  fetchWithRateLimitRetry,
  runPromisePool,
} from "@/lib/recognition-queue";

describe("runPromisePool", () => {
  it("limits concurrency and continues after an item fails", async () => {
    let active = 0;
    let maxActive = 0;
    const settled: string[] = [];

    const results = await runPromisePool({
      items: [1, 2, 3, 4, 5],
      concurrency: 2,
      task: async (item) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        if (item === 2) throw new Error("failed");
        return item * 10;
      },
      onSettled: (result) => settled.push(result.status),
    });

    expect(maxActive).toBe(2);
    expect(results).toHaveLength(5);
    expect(results[1].status).toBe("rejected");
    expect(results[4]).toEqual({ status: "fulfilled", value: 50 });
    expect(settled).toHaveLength(5);
  });
});

describe("fetchWithRateLimitRetry", () => {
  it("retries 429 responses with exponential delays", async () => {
    const statuses = [429, 429, 200];
    const fetcher = vi.fn(async () =>
      new Response(null, { status: statuses.shift() }),
    );
    const pause = vi.fn(async () => undefined);

    const response = await fetchWithRateLimitRetry("https://example.com", {}, {
      fetcher,
      wait: pause,
    });

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(pause.mock.calls).toEqual([[1_000], [2_000]]);
  });

  it("returns the third 429 response without a fourth request", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 429 }));
    const pause = vi.fn(async () => undefined);

    const response = await fetchWithRateLimitRetry("https://example.com", {}, {
      fetcher,
      wait: pause,
    });

    expect(response.status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(pause).toHaveBeenCalledTimes(2);
  });
});
