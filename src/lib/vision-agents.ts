import {
  DEFAULT_PARALLEL_REQUESTS,
  DEFAULT_SETTINGS,
  MAX_PARALLEL_REQUESTS,
  MIN_PARALLEL_REQUESTS,
} from "@/lib/constants";
import type { AgentConfig, AppSettings, VisionAgent, TableAgent } from "@/lib/types";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeSettings(value: any): AppSettings {
  const settings = value ?? {};
  const parallelRequests = normalizeParallelRequests(settings.parallelRequests);

  let visionAgents = settings.visionAgents;
  let activeVisionAgentId = settings.activeVisionAgentId;
  if (!Array.isArray(visionAgents) || visionAgents.length === 0) {
    const defaultVision = (DEFAULT_SETTINGS?.visionAgents && DEFAULT_SETTINGS.visionAgents[0]) || {
      baseUrl: "https://anymodel.org/v1/",
      apiKey: "",
      model: "cx/gpt-5.5-review",
    };
    const vision = settings.vision || defaultVision;
    const agent = createVisionAgent(vision);
    visionAgents = [agent];
    activeVisionAgentId = agent.id;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    activeVisionAgentId = visionAgents.some((agent: any) => agent.id === activeVisionAgentId)
      ? activeVisionAgentId
      : visionAgents[0].id;
  }

  let tableAgents = settings.tableAgents;
  let activeTableAgentId = settings.activeTableAgentId;
  if (!Array.isArray(tableAgents) || tableAgents.length === 0) {
    const defaultTable = (DEFAULT_SETTINGS?.tableAgents && DEFAULT_SETTINGS.tableAgents[0]) || {
      baseUrl: "https://routerai.ru/api/v1",
      apiKey: "",
      model: "deepseek/deepseek-v4-flash",
    };
    const table = settings.table || defaultTable;
    const agent = {
      id: "default-table-agent",
      name: "Excel-агент 1",
      baseUrl: table.baseUrl,
      apiKey: table.apiKey,
      model: table.model,
    };
    tableAgents = [agent];
    activeTableAgentId = agent.id;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    activeTableAgentId = tableAgents.some((agent: any) => agent.id === activeTableAgentId)
      ? activeTableAgentId
      : tableAgents[0].id;
  }

  return {
    visionAgents,
    activeVisionAgentId,
    tableAgents,
    activeTableAgentId,
    parallelRequests,
    table: settings.table || tableAgents[0],
    extractionPrompt: settings.extractionPrompt || DEFAULT_SETTINGS.extractionPrompt,
    agentTimeout: settings.agentTimeout ?? DEFAULT_SETTINGS.agentTimeout,
    pingHistory: settings.pingHistory,
  };
}

export function getActiveVisionAgent(settings: AppSettings) {
  return settings.visionAgents.find((agent) => agent.id === settings.activeVisionAgentId) ?? settings.visionAgents[0];
}

export function getActiveTableAgent(settings: AppSettings) {
  return settings.tableAgents.find((agent) => agent.id === settings.activeTableAgentId) ?? settings.tableAgents[0];
}

export function createEmptyVisionAgent(index: number): VisionAgent {
  return createVisionAgent({
    baseUrl: "https://anymodel.org/v1/",
    apiKey: "",
    model: "",
  }, index);
}

export function createEmptyTableAgent(index: number): TableAgent {
  return {
    id: crypto.randomUUID(),
    name: `Excel-агент ${index}`,
    baseUrl: "https://routerai.ru/api/v1",
    apiKey: "",
    model: "",
  };
}

