import {
  DEFAULT_PARALLEL_REQUESTS,
  DEFAULT_SETTINGS,
  MAX_PARALLEL_REQUESTS,
  MIN_PARALLEL_REQUESTS,
} from "@/lib/constants";
import type { AgentConfig, AppSettings, VisionAgent } from "@/lib/types";

type LegacySettings = Omit<AppSettings, "visionAgents" | "activeVisionAgentId" | "parallelRequests"> & {
  vision?: AgentConfig;
  parallelRequests?: number;
};

function createVisionAgent(config: AgentConfig, index = 1): VisionAgent {
  return {
    id: crypto.randomUUID(),
    name: `Агент распознавания ${index}`,
    ...config,
  };
}

export function normalizeParallelRequests(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_PARALLEL_REQUESTS;
  }
  return Math.min(
    MAX_PARALLEL_REQUESTS,
    Math.max(MIN_PARALLEL_REQUESTS, Math.round(value)),
  );
}

export function normalizeSettings(value: AppSettings | LegacySettings): AppSettings {
  const parallelRequests = normalizeParallelRequests(value.parallelRequests);

  if ("visionAgents" in value && Array.isArray(value.visionAgents) && value.visionAgents.length > 0) {
    const activeVisionAgentId = value.visionAgents.some((agent) => agent.id === value.activeVisionAgentId)
      ? value.activeVisionAgentId
      : value.visionAgents[0].id;
    return { ...value, activeVisionAgentId, parallelRequests };
  }

  const vision = "vision" in value && value.vision ? value.vision : DEFAULT_SETTINGS.visionAgents[0];
  const agent = createVisionAgent(vision);
  return {
    table: value.table,
    extractionPrompt: value.extractionPrompt,
    visionAgents: [agent],
    activeVisionAgentId: agent.id,
    parallelRequests,
  };
}

export function getActiveVisionAgent(settings: AppSettings) {
  return settings.visionAgents.find((agent) => agent.id === settings.activeVisionAgentId) ?? settings.visionAgents[0];
}

export function createEmptyVisionAgent(index: number): VisionAgent {
  return createVisionAgent({
    baseUrl: "https://anymodel.org/v1/",
    apiKey: "",
    model: "",
  }, index);
}
