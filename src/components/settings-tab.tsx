"use client";

import { useState } from "react";
import { CheckCircle2, CirclePlus, Eye, EyeOff, RotateCcw, ServerCog, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_EXTRACTION_PROMPT } from "@/lib/constants";
import { createEmptyVisionAgent } from "@/lib/vision-agents";
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
  const updateVisionAgent = (agent: VisionAgent) => {
    onChange({ ...settings, visionAgents: settings.visionAgents.map((current) => current.id === agent.id ? agent : current) });
  };

  return (
    <div className="space-y-4">
      <section className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <SectionTitle title="Агенты распознавания" description="Выберите один API-агент для распознавания документов." />
          <button type="button" title="Добавить агента" aria-label="Добавить агента" className="grid size-9 shrink-0 place-items-center rounded-md border border-[#cbd6d2] text-[#31685b] hover:bg-[#edf7f4]" onClick={() => {
            const agent = createEmptyVisionAgent(settings.visionAgents.length + 1);
            onChange({ ...settings, visionAgents: [...settings.visionAgents, agent], activeVisionAgentId: agent.id });
          }}><CirclePlus className="size-4" /></button>
        </div>
        {settings.visionAgents.map((agent) => (
          <AgentSection
            key={agent.id}
            title={agent.name || "Без названия"}
            name={agent.name}
            onNameChange={(name) => updateVisionAgent({ ...agent, name })}
            description="Vision-модель извлекает поля из изображений документов."
            value={agent}
            onChange={(value) => updateVisionAgent({ ...agent, ...value })}
            models={["cx/gpt-5.5-review"]}
            active={agent.id === settings.activeVisionAgentId}
            onActivate={() => onChange({ ...settings, activeVisionAgentId: agent.id })}
            onRemove={settings.visionAgents.length > 1 ? () => {
              const visionAgents = settings.visionAgents.filter((current) => current.id !== agent.id);
              onChange({ ...settings, visionAgents, activeVisionAgentId: agent.id === settings.activeVisionAgentId ? visionAgents[0].id : settings.activeVisionAgentId });
            } : undefined}
          />
        ))}
      </section>
      <AgentSection title="Excel-агент" description="Анализирует структуру таблицы и возвращает только точечные изменения." value={settings.table} onChange={(table) => onChange({ ...settings, table })} models={["deepseek/deepseek-v4-flash", "x-ai/grok-4.5"]} />
      <Card className="p-5">
        <SectionTitle title="Промт распознавания" description="Используется как system prompt для каждого изображения." action={<Button variant="secondary" onClick={() => onChange({ ...settings, extractionPrompt: DEFAULT_EXTRACTION_PROMPT })}><RotateCcw className="size-4" /> Сбросить к стандартному</Button>} />
        <textarea className="mt-5 min-h-64 w-full resize-y rounded-md border border-[#cbd6d2] bg-white p-3 text-sm leading-6 outline-none focus:border-[#23816e] focus:ring-2 focus:ring-[#23816e]/15" value={settings.extractionPrompt} onChange={(event) => onChange({ ...settings, extractionPrompt: event.target.value })} />
        <p className="mt-2 text-xs text-[#7b8985]">Настройки и ключи сохраняются только в localStorage этого браузера.</p>
      </Card>
    </div>
  );
}
