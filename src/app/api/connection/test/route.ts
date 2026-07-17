import { readAgentConfig, testConnection } from "@/lib/model-client";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const start = Date.now();
  try {
    const config = readAgentConfig(request);
    await testConnection(config);
    const latencyMs = Date.now() - start;
    return Response.json({ ok: true, latencyMs });
  } catch (error) {
    const latencyMs = Date.now() - start;
    return Response.json({
      ok: false,
      latencyMs,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
