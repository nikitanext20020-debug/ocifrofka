# Сохранённые агенты распознавания Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить сохранение нескольких API-агентов распознавания с возможностью выбрать ровно один активный, добавить новый и удалить ненужный.

**Architecture:** В `AppSettings` список `visionAgents` и `activeVisionAgentId` заменят единичный `vision`. Новый модуль нормализует настройки, мигрирует прежнюю конфигурацию и возвращает активный агент. Экран настроек управляет карточками агентов, а экран распознавания берёт конфигурацию активной карточки без изменения серверного API.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Zod, lucide-react, localStorage.

---

## File structure

- Create: `src/lib/vision-agents.ts` -- миграция старых настроек и поиск активной конфигурации.
- Create: `src/lib/vision-agents.test.ts` -- тесты миграции и выбора.
- Modify: `src/lib/types.ts` -- тип сохранённого vision-агента и новая форма настроек.
- Modify: `src/lib/constants.ts` -- исходный агент в новом формате.
- Modify: `src/components/app-shell.tsx` -- нормализация настроек после чтения localStorage.
- Modify: `src/components/settings-tab.tsx` -- добавление, выбор, редактирование и удаление агентов.
- Modify: `src/components/recognition-tab.tsx` -- использование только выбранного агента.
- Modify: `README.md` -- описание сохранённых агентов.

### Task 1: Типы, миграция и тесты

**Files:**
- Create: `src/lib/vision-agents.ts`
- Create: `src/lib/vision-agents.test.ts`
- Modify: `src/lib/types.ts:18-28`
- Modify: `src/lib/constants.ts:11-23`

- [ ] **Step 1: Write the failing tests for migration and active-agent selection**

```ts
import { describe, expect, it } from "vitest";
import { getActiveVisionAgent, normalizeSettings } from "@/lib/vision-agents";

const legacySettings = {
  vision: { baseUrl: "https://api.example.com/v1", apiKey: "secret", model: "vision-1" },
  table: { baseUrl: "https://api.example.com/v1", apiKey: "table", model: "table-1" },
  extractionPrompt: "Распознай документ и верни JSON.",
};

describe("normalizeSettings", () => {
  it("migrates the old vision configuration into the active agent", () => {
    const settings = normalizeSettings(legacySettings);
    expect(settings.visionAgents).toHaveLength(1);
    expect(settings.visionAgents[0]).toMatchObject({ name: "Агент распознавания 1", ...legacySettings.vision });
    expect(settings.activeVisionAgentId).toBe(settings.visionAgents[0].id);
  });
});

describe("getActiveVisionAgent", () => {
  it("returns the selected agent", () => {
    const settings = normalizeSettings(legacySettings);
    const second = { ...settings.visionAgents[0], id: "second", name: "Резервный", apiKey: "other" };
    expect(getActiveVisionAgent({ ...settings, visionAgents: [...settings.visionAgents, second], activeVisionAgentId: "second" })).toBe(second);
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- src/lib/vision-agents.test.ts`

Expected: FAIL because module `@/lib/vision-agents` does not exist.

- [ ] **Step 3: Define the stored agent types**

Replace the `AppSettings` definition in `src/lib/types.ts` with:

```ts
export type VisionAgent = AgentConfig & {
  id: string;
  name: string;
};

export type AppSettings = {
  visionAgents: VisionAgent[];
  activeVisionAgentId: string;
  table: AgentConfig;
  extractionPrompt: string;
};
```

- [ ] **Step 4: Implement migration helpers**

Create `src/lib/vision-agents.ts`:

```ts
import { DEFAULT_SETTINGS } from "@/lib/constants";
import type { AgentConfig, AppSettings, VisionAgent } from "@/lib/types";

type LegacySettings = Omit<AppSettings, "visionAgents" | "activeVisionAgentId"> & { vision?: AgentConfig };

function createVisionAgent(config: AgentConfig, index = 1): VisionAgent {
  return { id: crypto.randomUUID(), name: `Агент распознавания ${index}`, ...config };
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
  return { table: value.table, extractionPrompt: value.extractionPrompt, visionAgents: [agent], activeVisionAgentId: agent.id };
}

export function getActiveVisionAgent(settings: AppSettings) {
  return settings.visionAgents.find((agent) => agent.id === settings.activeVisionAgentId) ?? settings.visionAgents[0];
}

export function createEmptyVisionAgent(): VisionAgent {
  return createVisionAgent({ baseUrl: "https://anymodel.org/v1/", apiKey: "", model: "" });
}
```

- [ ] **Step 5: Update defaults to the new settings shape**

Change the vision portion of `DEFAULT_SETTINGS` in `src/lib/constants.ts` to:

```ts
visionAgents: [{
  id: "default-vision-agent",
  name: "Агент распознавания 1",
  baseUrl: "https://anymodel.org/v1/",
  apiKey: "",
  model: "cx/gpt-5.5-review",
}],
activeVisionAgentId: "default-vision-agent",
```

- [ ] **Step 6: Run the focused test to verify it passes**

Run: `npm test -- src/lib/vision-agents.test.ts`

Expected: PASS with 2 tests.

### Task 2: Normalize settings at application startup

**Files:**
- Modify: `src/components/app-shell.tsx:5-28`

- [ ] **Step 1: Import the migration helper**

Add:

```ts
import { normalizeSettings } from "@/lib/vision-agents";
```

- [ ] **Step 2: Persist migrated settings once after localStorage is read**

Add this effect after the existing quota-storage effect:

```ts
useEffect(() => {
  const normalized = normalizeSettings(settings);
  if (JSON.stringify(normalized) !== JSON.stringify(settings)) setSettings(normalized);
}, [setSettings, settings]);
```

- [ ] **Step 3: Run type checking**

Run: `npm run typecheck`

Expected: PASS.

### Task 3: Add agent management controls to Settings

**Files:**
- Modify: `src/components/settings-tab.tsx:3-150`

- [ ] **Step 1: Add the required icons and helpers**

Extend the lucide import with `CirclePlus`, `Trash2`, and `Check`. Import `createEmptyVisionAgent` from `@/lib/vision-agents` and `VisionAgent` from `@/lib/types`.

- [ ] **Step 2: Adapt AgentSection to a named, selectable vision agent**

Add optional properties to `AgentSection`:

```ts
agentId?: string;
active?: boolean;
onActivate?: () => void;
onRemove?: () => void;
canRemove?: boolean;
```

Before the existing title render, add a header row with a radio input when `onActivate` exists. It calls `onActivate`, uses `checked={active}`, and has `aria-label={`Выбрать ${value.name}`}`. Add an editable name field before `base_url` by changing `value` to `VisionAgent` only in the vision wrapper, or pass `name`/`onNameChange` separately. Place the trash icon button at the header right; render it only when `canRemove` is true and call `onRemove`.

- [ ] **Step 3: Replace the single vision section with managed cards**

Replace the first `AgentSection` in `SettingsTab` with a settings heading, an icon-only add button, and mapped cards:

```tsx
<div className="space-y-3">
  <div className="flex items-center justify-between">
    <SectionTitle title="Агенты распознавания" description="Выберите один API-агент для распознавания документов." />
    <button
      type="button"
      title="Добавить агента"
      className="grid size-9 place-items-center rounded-md border border-[#cbd6d2] text-[#31685b] hover:bg-[#edf7f4]"
      onClick={() => {
        const agent = createEmptyVisionAgent();
        onChange({ ...settings, visionAgents: [...settings.visionAgents, agent], activeVisionAgentId: agent.id });
      }}
    ><CirclePlus className="size-4" /></button>
  </div>
  {settings.visionAgents.map((agent) => (
    <AgentSection
      key={agent.id}
      title={agent.name || "Без названия"}
      description="Vision-модель извлекает поля из изображений документов."
      value={agent}
      onChange={(next) => onChange({ ...settings, visionAgents: settings.visionAgents.map((item) => item.id === agent.id ? { ...agent, ...next } : item })}
      models={["cx/gpt-5.5-review"]}
      active={agent.id === settings.activeVisionAgentId}
      onActivate={() => onChange({ ...settings, activeVisionAgentId: agent.id })}
      canRemove={settings.visionAgents.length > 1}
      onRemove={() => {
        const visionAgents = settings.visionAgents.filter((item) => item.id !== agent.id);
        onChange({ ...settings, visionAgents, activeVisionAgentId: agent.id === settings.activeVisionAgentId ? visionAgents[0].id : settings.activeVisionAgentId });
      }}
    />
  ))}
</div>
```

Keep the Excel agent card unchanged.

- [ ] **Step 4: Run lint and type checking**

Run: `npm run lint && npm run typecheck`

Expected: PASS.

### Task 4: Use the selected agent for recognition

**Files:**
- Modify: `src/components/recognition-tab.tsx:16-98`

- [ ] **Step 1: Resolve the active agent at component render**

Add the import and local variable:

```ts
import { getActiveVisionAgent } from "@/lib/vision-agents";

const activeVisionAgent = getActiveVisionAgent(settings);
```

- [ ] **Step 2: Pass only its configuration to the existing request**

Replace both references to `settings.vision` in `recognize`:

```ts
if (!activeVisionAgent.apiKey) {
  toast.error(`Укажите API-ключ агента «${activeVisionAgent.name}» в настройках`);
  return;
}
```

```ts
headers: agentHeaders(activeVisionAgent),
```

- [ ] **Step 3: Run the complete verification suite**

Run: `npm run lint && npm run typecheck && npm test && npm run build`

Expected: all commands exit with code 0.

### Task 5: Update project documentation

**Files:**
- Modify: `README.md:34-50`

- [ ] **Step 1: Describe saved, selectable vision agents**

Add below the provider presets:

```md
В настройках распознавания можно сохранить несколько API-агентов с разными ключами и моделями. Перед запуском распознавания выберите один активный агент; все конфигурации сохраняются только в localStorage браузера. Ненужные агенты можно удалить.
```

- [ ] **Step 2: Re-run the final verification**

Run: `npm run lint && npm run typecheck && npm test && npm run build`

Expected: all commands exit with code 0.
