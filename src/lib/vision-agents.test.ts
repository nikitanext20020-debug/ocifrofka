import { describe, expect, it } from "vitest";
import { getActiveVisionAgent, normalizeSettings } from "@/lib/vision-agents";

const legacySettings = {
  vision: {
    baseUrl: "https://api.example.com/v1",
    apiKey: "secret",
    model: "vision-1",
  },
  table: {
    baseUrl: "https://api.example.com/v1",
    apiKey: "table",
    model: "table-1",
  },
  extractionPrompt: "Распознай документ и верни JSON.",
};

describe("normalizeSettings", () => {
  it("migrates the previous vision configuration into an active agent", () => {
    const settings = normalizeSettings(legacySettings);

    expect(settings.visionAgents).toHaveLength(1);
    expect(settings.visionAgents[0]).toMatchObject({
      name: "Агент распознавания 1",
      ...legacySettings.vision,
    });
    expect(settings.activeVisionAgentId).toBe(settings.visionAgents[0].id);
  });
});

describe("getActiveVisionAgent", () => {
  it("returns the selected agent", () => {
    const settings = normalizeSettings(legacySettings);
    const second = {
      ...settings.visionAgents[0],
      id: "second",
      name: "Резервный",
      apiKey: "other",
    };

    expect(
      getActiveVisionAgent({
        ...settings,
        visionAgents: [...settings.visionAgents, second],
        activeVisionAgentId: second.id,
      }),
    ).toBe(second);
  });
});
