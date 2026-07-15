"use client";

import { useState } from "react";
import { CheckCircle2, CirclePlus, Eye, EyeOff, RotateCcw, Save, ServerCog, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_EXTRACTION_PROMPT,
  MAX_PARALLEL_REQUESTS,
  MIN_PARALLEL_REQUESTS,
} from "@/lib/constants";
import { createEmptyVisionAgent, normalizeParallelRequests } from "@/lib/vision-agents";
import type { AgentConfig, AppSettings, VisionAgent } from "@/lib/types";
import { agentHeaders, readApiResponse } from "@/lib/utils";
import { Button, Card, Input, SectionTitle } from "@/components/ui";

const BASE_PRESETS = [
  ["AnyModel", "https://anymodel.org/v1/"],
  ["RouterAI", "https://routerai.ru/api/v1"],
  ["OpenAI", "https://api.openai.com/v1"],
  ["DeepSeek", "https://api.deepseek.com"],
  ["xAI", "https://api.x.ai/v1"],
] as const;

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
}) {
  const [showKey, setShowKey] = useState(false);
  const [checking, setChecking] = useState(false);
  const [success, setSuccess] = useState(false);

  const set = (field: keyof AgentConfig, fieldValue: string) => {
    setSuccess(false);
    onChange({ ...value, [field]: fieldValue });
  };

  const check = async () => {
    setChecking(true);
    setSuccess(false);
    try {
      await readApiResponse(
        await fetch("/api/connection/test", {
          method: "POST",
          headers: agentHeaders(value),
          body: "{}",
        }),
      );
      setSuccess(true);
      toast.success("Подключение работает");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка подключения");
    } finally {
      setChecking(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        {onActivate && (
          <input
            className="mt-1 size-4 accent-[#176b5b]"
            type="radio"
            name="active-vision-agent"
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
      <div className="mt-5 flex items-center gap-3">
        <Button variant="secondary" loading={checking} onClick={check}><ServerCog className="size-4" /> Проверить подключение</Button>
        {success && <span className="inline-flex items-center gap-1 text-sm font-medium text-[#16715e]"><CheckCircle2 className="size-4" /> Подключено</span>}
      </div>
    </Card>
  );
}

export function SettingsTab({ settings, onChange }: { settings: AppSettings; onChange: (settings: AppSettings) => void }) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [prevSettings, setPrevSettings] = useState<AppSettings>(settings);

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

  return (
    <div className="space-y-4 pb-24">
      <section className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <SectionTitle title="Агенты распознавания" description="Выберите один API-агент для распознавания документов." />
          <button type="button" title="Добавить агента" aria-label="Добавить агента" className="grid size-9 shrink-0 place-items-center rounded-md border border-[#cbd6d2] text-[#31685b] hover:bg-[#edf7f4]" onClick={() => {
            const agent = createEmptyVisionAgent(draft.visionAgents.length + 1);
            setDraft((current) => ({ ...current, visionAgents: [...current.visionAgents, agent], activeVisionAgentId: agent.id }));
          }}><CirclePlus className="size-4" /></button>
        </div>
        {draft.visionAgents.map((agent) => (
          <AgentSection
            key={agent.id}
            title={agent.name || "Без названия"}
            name={agent.name}
            onNameChange={(name) => updateVisionAgent({ ...agent, name })}
            description="Vision-модель извлекает поля из изображений документов."
            value={agent}
            onChange={(value) => updateVisionAgent({ ...agent, ...value })}
            models={["cx/gpt-5.5-review"]}
            active={agent.id === draft.activeVisionAgentId}
            onActivate={() => setDraft((current) => ({ ...current, activeVisionAgentId: agent.id }))}
            onRemove={draft.visionAgents.length > 1 ? () => {
              setDraft((current) => {
                const visionAgents = current.visionAgents.filter((item) => item.id !== agent.id);
                return { ...current, visionAgents, activeVisionAgentId: agent.id === current.activeVisionAgentId ? visionAgents[0].id : current.activeVisionAgentId };
              });
            } : undefined}
          />
        ))}
      </section>
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
      <AgentSection title="Excel-агент" description="Анализирует структуру таблицы и возвращает только точечные изменения." value={draft.table} onChange={(table) => setDraft((current) => ({ ...current, table }))} models={["deepseek/deepseek-v4-flash", "x-ai/grok-4.5"]} />
      <Card className="p-5">
        <SectionTitle title="Промт распознавания" description="Используется как system prompt для каждого изображения." action={<Button variant="secondary" onClick={() => setDraft((current) => ({ ...current, extractionPrompt: DEFAULT_EXTRACTION_PROMPT }))}><RotateCcw className="size-4" /> Сбросить к стандартному</Button>} />
        <textarea className="mt-5 min-h-64 w-full resize-y rounded-md border border-[#cbd6d2] bg-white p-3 text-sm leading-6 outline-none focus:border-[#23816e] focus:ring-2 focus:ring-[#23816e]/15" value={draft.extractionPrompt} onChange={(event) => setDraft((current) => ({ ...current, extractionPrompt: event.target.value }))} />
        <p className="mt-2 text-xs text-[#7b8985]">Настройки и ключи сохраняются только в localStorage этого браузера.</p>
      </Card>

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
