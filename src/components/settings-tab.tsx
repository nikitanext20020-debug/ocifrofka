"use client";

import { useEffect, useState } from "react";
import { CirclePlus, Eye, EyeOff, RotateCcw, Save, ServerCog, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_EXTRACTION_PROMPT,
  MAX_PARALLEL_REQUESTS,
  MIN_PARALLEL_REQUESTS,
} from "@/lib/constants";
import {
  createEmptyVisionAgent,
  createEmptyTableAgent,
  normalizeParallelRequests,
} from "@/lib/vision-agents";
import type { AgentConfig, AppSettings, VisionAgent, TableAgent } from "@/lib/types";
import { agentHeaders, readApiResponse } from "@/lib/utils";
import { loggedFetch } from "@/lib/app-logs";
import { Button, Card, Input, SectionTitle } from "@/components/ui";

const getTimestamp = () => Date.now();

const BASE_PRESETS = [
  ["AnyModel", "https://anymodel.org/v1/"],
  ["RouterAI", "https://routerai.ru/api/v1"],
  ["OpenAI", "https://api.openai.com/v1"],
  ["DeepSeek", "https://api.deepseek.com"],
  ["xAI", "https://api.x.ai/v1"],
] as const;

function formatPingTime(timestamp: number) {
  const diffMs = Date.now() - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "проверено только что";
  if (diffMins < 60) return `проверено ${diffMins} мин назад`;
  const diffHours = Math.floor(diffMins / 60);
  return `проверено ${diffHours} ч назад`;
}

function AgentSection({
  title,
  description,
  value,
  onChange,
  models,
  name,
  onNameChange,
  active,
  onActivate,
  onRemove,
  pingResult,
  onPing,
  radioName,
}: {
  title: string;
  description: string;
  value: AgentConfig;
  onChange: (value: AgentConfig) => void;
  models: string[];
  name?: string;
  onNameChange?: (name: string) => void;
  active?: boolean;
  onActivate?: () => void;
  onRemove?: () => void;
  pingResult?: { latencyMs: number; timestamp: number; error?: string };
  onPing?: () => Promise<unknown>;
  radioName: string;
}) {
  const [showKey, setShowKey] = useState(false);
  const [checking, setChecking] = useState(false);

  const set = (field: keyof AgentConfig, fieldValue: string) => {
    onChange({ ...value, [field]: fieldValue });
  };

  const handlePing = async () => {
    if (!onPing) return;
    setChecking(true);
    try {
      await onPing();
    } finally {
      setChecking(false);
    }
  };

  const badgeStyle = pingResult
    ? pingResult.error
      ? "bg-red-100 text-red-800 border-red-200"
      : pingResult.latencyMs < 2000
        ? "bg-green-100 text-green-800 border-green-200"
        : pingResult.latencyMs <= 8000
          ? "bg-yellow-100 text-yellow-800 border-yellow-200"
          : "bg-red-100 text-red-800 border-red-200"
    : null;

  const badgeText = pingResult
    ? pingResult.error
      ? "ошибка"
      : `${(pingResult.latencyMs / 1000).toFixed(2)}с`
    : "";

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        {onActivate && (
          <input
            className="mt-1 size-4 accent-[#176b5b]"
            type="radio"
            name={radioName}
            checked={active}
            onChange={onActivate}
            aria-label={`Выбрать ${title}`}
          />
        )}
        <div className="min-w-0 flex-1">
          {onNameChange ? (
            <Input value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="Название агента" />
          ) : (
            <SectionTitle title={title} description={description} />
          )}
          {onNameChange && <p className="mt-1 text-sm text-[#71807b]">{description}</p>}
        </div>
        {onRemove && (
          <button
            type="button"
            title="Удалить агента"
            aria-label={`Удалить ${title}`}
            className="grid size-9 shrink-0 place-items-center rounded-md border border-[#e3cfca] text-[#a54b3e] hover:bg-[#fff0ed]"
            onClick={onRemove}
          ><Trash2 className="size-4" /></button>
        )}
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <label className="block lg:col-span-2">
          <span className="mb-1.5 block text-sm font-medium">base_url</span>
          <Input value={value.baseUrl} onChange={(event) => set("baseUrl", event.target.value)} />
          <div className="mt-2 flex flex-wrap gap-2">
            {BASE_PRESETS.map(([presetName, url]) => (
              <button key={presetName} className="rounded border border-[#d4dfdb] px-2 py-1 text-xs text-[#53615d] hover:bg-[#f2f6f4]" onClick={() => set("baseUrl", url)} type="button">{presetName}</button>
            ))}
          </div>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">API-ключ</span>
          <div className="relative">
            <Input className="pr-10" type={showKey ? "text" : "password"} value={value.apiKey} autoComplete="off" onChange={(event) => set("apiKey", event.target.value)} placeholder="Хранится только в этом браузере" />
            <button type="button" title={showKey ? "Скрыть ключ" : "Показать ключ"} className="absolute right-2 top-2 p-1 text-[#687671]" onClick={() => setShowKey((current) => !current)}>{showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
          </div>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">ID модели</span>
          <Input list={`${title}-models`} value={value.model} onChange={(event) => set("model", event.target.value)} />
          <datalist id={`${title}-models`}>{models.map((model) => <option value={model} key={model} />)}</datalist>
        </label>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {onPing && (
          <Button variant="secondary" loading={checking} onClick={handlePing}><ServerCog className="size-4" /> Проверить</Button>
        )}
        {pingResult && badgeStyle && (
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center border rounded px-2.5 py-0.5 text-xs font-semibold ${badgeStyle}`}
              title={pingResult.error || "Подключение успешно"}
            >
              {badgeText}
            </span>
            <span className="text-xs text-[#71807b]">{formatPingTime(pingResult.timestamp)}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

export function SettingsTab({ settings, onChange }: { settings: AppSettings; onChange: (settings: AppSettings) => void }) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [prevSettings, setPrevSettings] = useState<AppSettings>(settings);
  const [pingAllChecking, setPingAllChecking] = useState<Record<string, boolean>>({});

  // Sync draft when the persisted settings change externally (e.g. after save/normalize).
  if (prevSettings !== settings) {
    setPrevSettings(settings);
    setDraft(settings);
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  const save = () => {
    onChange(draft);
    toast.success("Настройки сохранены");
  };

  const discard = () => {
    setDraft(settings);
    toast.info("Изменения отменены");
  };

  const updateVisionAgent = (agent: VisionAgent) => {
    setDraft((current) => ({ ...current, visionAgents: current.visionAgents.map((item) => item.id === agent.id ? agent : item) }));
  };

  const updateTableAgent = (agent: TableAgent) => {
    setDraft((current) => ({ ...current, tableAgents: current.tableAgents.map((item) => item.id === agent.id ? agent : item) }));
  };

  // Ping a single agent and save in state
  const pingAgent = async (agentId: string, agent: AgentConfig) => {
    const start = getTimestamp();
    const controller = new AbortController();
    const tId = setTimeout(() => controller.abort(), 10000); // 10s timeout
    try {
      const response = await loggedFetch(
        "/api/connection/test",
        {
          method: "POST",
          headers: agentHeaders(agent),
          body: "{}",
          signal: controller.signal,
        },
        { area: "Настройки", action: "Проверка подключения" },
      );
      clearTimeout(tId);
      const result = await readApiResponse<{ ok: boolean; latencyMs: number; error?: string }>(response);
      if (!result.ok) throw new Error(result.error || "Ошибка подключения");

      setDraft((current) => {
        const pingHistory = current.pingHistory || {};
        return {
          ...current,
          pingHistory: {
            ...pingHistory,
            [agentId]: { latencyMs: result.latencyMs, timestamp: getTimestamp() },
          },
        };
      });
      toast.success(`Агент «${agent.model || "default"}» доступен`);
      return { latencyMs: result.latencyMs, success: true };
    } catch (error) {
      clearTimeout(tId);
      const duration = getTimestamp() - start;
      const err = error as { name?: string; message?: string };
      const errorMsg = err?.name === "AbortError" ? "Превышен таймаут 10с" : (err?.message || String(error));
      setDraft((current) => {
        const pingHistory = current.pingHistory || {};
        return {
          ...current,
          pingHistory: {
            ...pingHistory,
            [agentId]: { latencyMs: duration, timestamp: getTimestamp(), error: errorMsg },
          },
        };
      });
      toast.error(`Сбой агента: ${errorMsg}`);
      return { latencyMs: duration, success: false, error: errorMsg };
    }
  };

  const pingAllSection = async (section: "vision" | "table") => {
    setPingAllChecking((current) => ({ ...current, [section]: true }));
    const agents = section === "vision" ? draft.visionAgents : draft.tableAgents;
    try {
      const promises = agents.map((agent) => pingAgent(agent.id, agent));
      await Promise.all(promises);


      // Sort draft agents by latency
      setDraft((current) => {
        const history = current.pingHistory || {};
        const getLatency = (agentId: string) => {
          const res = history[agentId];
          if (!res) return Infinity;
          if (res.error) return Infinity;
          return res.latencyMs;
        };

        if (section === "vision") {
          const sorted = [...current.visionAgents].sort((a, b) => getLatency(a.id) - getLatency(b.id));
          return { ...current, visionAgents: sorted };
        } else {
          const sorted = [...current.tableAgents].sort((a, b) => getLatency(a.id) - getLatency(b.id));
          return { ...current, tableAgents: sorted };
        }
      });
      toast.success("Все агенты проверены и отсортированы по латентности");
    } finally {
      setPingAllChecking((current) => ({ ...current, [section]: false }));
    }
  };

  // Periodic force update of formatting timestamps
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="space-y-4 pb-24">
      {/* Vision Agents Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <SectionTitle title="Агенты распознавания" description="Выберите один API-агент для распознавания документов." />
          <div className="flex items-center gap-2">
            <Button variant="secondary" className="h-9 text-xs" loading={pingAllChecking["vision"]} onClick={() => pingAllSection("vision")}>Проверить все</Button>
            <button type="button" title="Добавить агента" aria-label="Добавить агента" className="grid size-9 shrink-0 place-items-center rounded-md border border-[#cbd6d2] text-[#31685b] hover:bg-[#edf7f4]" onClick={() => {
              const agent = createEmptyVisionAgent(draft.visionAgents.length + 1);
              setDraft((current) => ({ ...current, visionAgents: [...current.visionAgents, agent], activeVisionAgentId: agent.id }));
            }}><CirclePlus className="size-4" /></button>
          </div>
        </div>
        {draft.visionAgents.map((agent) => (
          <AgentSection
            key={agent.id}
            title={agent.name || "Без названия"}
            name={agent.name}
            radioName="active-vision-agent"
            onNameChange={(name) => updateVisionAgent({ ...agent, name })}
            description="Vision-модель извлекает поля из изображений документов."
            value={agent}
            onChange={(value) => updateVisionAgent({ ...agent, ...value })}
            models={["cx/gpt-5.5-review", "deepseek/deepseek-chat", "openai/gpt-4o"]}
            active={agent.id === draft.activeVisionAgentId}
            onActivate={() => setDraft((current) => ({ ...current, activeVisionAgentId: agent.id }))}
            onRemove={draft.visionAgents.length > 1 ? () => {
              setDraft((current) => {
                const visionAgents = current.visionAgents.filter((item) => item.id !== agent.id);
                return { ...current, visionAgents, activeVisionAgentId: agent.id === current.activeVisionAgentId ? visionAgents[0].id : current.activeVisionAgentId };
              });
            } : undefined}
            pingResult={draft.pingHistory?.[agent.id]}
            onPing={() => pingAgent(agent.id, agent)}
          />
        ))}
      </section>

      {/* Recognition Performance */}
      <Card className="p-5">
        <SectionTitle
          title="Производительность распознавания"
          description="Настройте число изображений, которые обрабатываются одновременно."
        />
        <label className="mt-5 block max-w-sm">
          <span className="mb-1.5 block text-sm font-medium">Параллельные запросы</span>
          <Input
            className="w-32"
            type="number"
            min={MIN_PARALLEL_REQUESTS}
            max={MAX_PARALLEL_REQUESTS}
            step={1}
            value={normalizeParallelRequests(draft.parallelRequests)}
            onChange={(event) => setDraft((current) => ({
              ...current,
              parallelRequests: normalizeParallelRequests(Number(event.target.value)),
            }))}
          />
          <span className="mt-1.5 block text-xs leading-5 text-[#71807b]">
            От {MIN_PARALLEL_REQUESTS} до {MAX_PARALLEL_REQUESTS}. Чем выше значение, тем быстрее обработка, но тем вероятнее лимиты провайдера.
          </span>
        </label>
      </Card>

      {/* Configurable Timeout Section */}
      <Card className="p-5">
        <SectionTitle
          title="Таймаут запросов"
          description="Таймаут ответа API-агентов (для автопереключения при зависании)."
        />
        <label className="mt-5 block max-w-sm">
          <span className="mb-1.5 block text-sm font-medium">Таймаут (в секундах)</span>
          <Input
            className="w-32"
            type="number"
            min={5}
            max={300}
            step={1}
            value={draft.agentTimeout ?? 60}
            onChange={(event) => setDraft((current) => ({
              ...current,
              agentTimeout: Math.max(5, Math.min(300, Number(event.target.value) || 60)),
            }))}
          />
          <span className="mt-1.5 block text-xs leading-5 text-[#71807b]">
            По умолчанию 60 секунд. Если агент не отвечает дольше этого времени, произойдет переключение на резервного агента.
          </span>
        </label>
      </Card>

      {/* Table Agents (Excel-агент) Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <SectionTitle title="Excel-агенты" description="Агенты для анализа структуры таблиц и заполнения пропусков." />
          <div className="flex items-center gap-2">
            <Button variant="secondary" className="h-9 text-xs" loading={pingAllChecking["table"]} onClick={() => pingAllSection("table")}>Проверить все</Button>
            <button type="button" title="Добавить агента" aria-label="Добавить агента" className="grid size-9 shrink-0 place-items-center rounded-md border border-[#cbd6d2] text-[#31685b] hover:bg-[#edf7f4]" onClick={() => {
              const agent = createEmptyTableAgent(draft.tableAgents.length + 1);
              setDraft((current) => ({ ...current, tableAgents: [...current.tableAgents, agent], activeTableAgentId: agent.id }));
            }}><CirclePlus className="size-4" /></button>
          </div>
        </div>
        {draft.tableAgents.map((agent) => (
          <AgentSection
            key={agent.id}
            title={agent.name || "Без названия"}
            name={agent.name}
            radioName="active-table-agent"
            onNameChange={(name) => updateTableAgent({ ...agent, name })}
            description="Excel-агент анализирует структуру таблицы и возвращает точечные изменения."
            value={agent}
            onChange={(value) => updateTableAgent({ ...agent, ...value })}
            models={["deepseek/deepseek-v4-flash", "x-ai/grok-4.5", "openai/gpt-4o"]}
            active={agent.id === draft.activeTableAgentId}
            onActivate={() => setDraft((current) => ({ ...current, activeTableAgentId: agent.id }))}
            onRemove={draft.tableAgents.length > 1 ? () => {
              setDraft((current) => {
                const tableAgents = current.tableAgents.filter((item) => item.id !== agent.id);
                return { ...current, tableAgents, activeTableAgentId: agent.id === current.activeTableAgentId ? tableAgents[0].id : current.activeTableAgentId };
              });
            } : undefined}
            pingResult={draft.pingHistory?.[agent.id]}
            onPing={() => pingAgent(agent.id, agent)}
          />
        ))}
      </section>

      {/* Extraction Prompt */}
      <Card className="p-5">
        <SectionTitle title="Промт распознавания" description="Используется как system prompt для каждого изображения." action={<Button variant="secondary" onClick={() => setDraft((current) => ({ ...current, extractionPrompt: DEFAULT_EXTRACTION_PROMPT }))}><RotateCcw className="size-4" /> Сбросить к стандартному</Button>} />
        <textarea className="mt-5 min-h-64 w-full resize-y rounded-md border border-[#cbd6d2] bg-white p-3 text-sm leading-6 outline-none focus:border-[#23816e] focus:ring-2 focus:ring-[#23816e]/15" value={draft.extractionPrompt} onChange={(event) => setDraft((current) => ({ ...current, extractionPrompt: event.target.value }))} />
        <p className="mt-2 text-xs text-[#7b8985]">Настройки и ключи сохраняются только в localStorage этого браузера.</p>
      </Card>

      {/* Bottom Save/Discard Bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[#dce5e1] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1540px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <span className="text-sm text-[#71807b]">
            {dirty ? "Есть несохранённые изменения" : "Все изменения сохранены"}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={discard} disabled={!dirty}>Отменить</Button>
            <Button onClick={save} disabled={!dirty}><Save className="size-4" /> Сохранить</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
