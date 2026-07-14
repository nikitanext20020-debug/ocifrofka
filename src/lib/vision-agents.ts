import { DEFAULT_SETTINGS } from "@/lib/constants";
import type { AgentConfig, AppSettings, VisionAgent } from "@/lib/types";

type LegacySettings = Omit<AppSettings, "visionAgents" | "activeVisionAgentId"> & {
  vision?: AgentConfig;
};

function createVisionAgent(config: AgentConfig, index = 1): VisionAgent {
  return {
    id: crypto.randomUUID(),
    name: `Агент распознавания ${index}`,
    ...config,
  };
}

export function normalizeSettings(value: AppSettings | LegacySettings): AppSettings {
  if ("visionAgents" in value && Array.isArray(value.visionAgents) && value.visionAgents.length > 0) {
    const activeVisionAgentId = value.visionAgents.some((agent) => agent.id === value.activeVisionAgentId)
      ? value.activeVisionAgentId
      : value.visionAgents[0].id;
    return { ...value, activeVisionAgentId };
  }

  const vision = "vision" in value && value.vision ? value.vision : DEFAULT_SETTINGS.visionAgents[0];
  const agent = createVisionAgent(vision);
  return {
    table: value.table,
    extractionPrompt: value.extractionPrompt,
    visionAgents: [agent],
    activeVisionAgentId: agent.id,
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
