import { apiError, readAgentConfig, testConnection } from "@/lib/model-client";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const config = readAgentConfig(request);
    await testConnection(config);
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
