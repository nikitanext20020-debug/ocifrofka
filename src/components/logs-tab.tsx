"use client";

import { useEffect, useState } from "react";
import { Clipboard, Download, FileWarning, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  clearAppLogs,
  diagnosticExport,
  diagnosticText,
  readAppLogs,
  subscribeAppLogs,
  type AppLogEntry,
} from "@/lib/app-logs";
import { cn, downloadBlob } from "@/lib/utils";
import { Button, Card, EmptyState, SectionTitle } from "@/components/ui";

const LEVEL_LABELS = {
  info: "Информация",
  warning: "Предупреждение",
  error: "Ошибка",
} as const;

async function copyText(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Fall back to the browser's legacy copy command below.
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard is unavailable");
}

export function LogsTab() {
  const [logs, setLogs] = useState<AppLogEntry[]>([]);

  useEffect(() => {
    const refresh = () => setLogs(readAppLogs());
    refresh();
    return subscribeAppLogs(refresh);
  }, []);

  const copyLogs = async () => {
    try {
      await copyText(diagnosticText(logs));
      toast.success("Логи скопированы");
    } catch {
      toast.error("Не удалось скопировать логи. Скачайте JSON-файл.");
    }
  };

  const downloadLogs = () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadBlob(
      new Blob([JSON.stringify(diagnosticExport(logs), null, 2)], { type: "application/json;charset=utf-8" }),
      `ocifrofka-logs-${stamp}.json`,
    );
  };

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <SectionTitle
          title="Диагностические логи"
          description="Здесь сохраняются действия, HTTP-статусы, длительность запросов и ошибки. API-ключи, ФИО, адреса, телефоны, файлы и содержимое таблиц в журнал не попадают."
          action={(
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={copyLogs} disabled={!logs.length}><Clipboard className="size-4" /> Копировать</Button>
              <Button variant="secondary" onClick={downloadLogs} disabled={!logs.length}><Download className="size-4" /> Скачать JSON</Button>
              <Button
                variant="danger"
                onClick={() => {
                  clearAppLogs();
                  toast.success("Логи очищены");
                }}
                disabled={!logs.length}
              >
                <Trash2 className="size-4" /> Очистить
              </Button>
            </div>
          )}
        />
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-[#61706b]">
          <span className="rounded-full bg-[#edf3f0] px-2.5 py-1">Всего: {logs.length}</span>
          <span className="rounded-full bg-[#fff0ed] px-2.5 py-1 text-[#9b3129]">Ошибок: {logs.filter(({ level }) => level === "error").length}</span>
          <span>Хранятся последние 200 событий только в этом браузере.</span>
        </div>
      </Card>

      {!logs.length ? (
        <Card><EmptyState icon={<FileWarning className="size-9" />} title="Логов пока нет" text="Выполните распознавание, анализ таблицы или генерацию. События появятся здесь автоматически." /></Card>
      ) : (
        <Card>
          <div className="divide-y divide-[#e2e9e6]">
            {logs.map((entry) => (
              <article className="p-4 sm:p-5" key={entry.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-semibold",
                    entry.level === "info" && "bg-[#e5f4ee] text-[#176b5b]",
                    entry.level === "warning" && "bg-[#fff4d9] text-[#8a641a]",
                    entry.level === "error" && "bg-[#fff0ed] text-[#a13d34]",
                  )}>
                    {LEVEL_LABELS[entry.level]}
                  </span>
                  <span className="text-sm font-semibold text-[#293733]">{entry.area}</span>
                  <time className="text-xs text-[#75827e]" dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleString("ru-RU")}</time>
                </div>
                <p className="mt-2 text-sm text-[#33423e]">{entry.message}</p>
                {(entry.status !== undefined || entry.durationMs !== undefined) && (
                  <p className="mt-1 text-xs text-[#71807b]">
                    {entry.status !== undefined ? `HTTP ${entry.status}` : ""}
                    {entry.status !== undefined && entry.durationMs !== undefined ? " · " : ""}
                    {entry.durationMs !== undefined ? `${entry.durationMs} мс` : ""}
                  </p>
                )}
                {entry.details && (
                  <pre className="mt-3 overflow-x-auto rounded-md bg-[#f4f7f5] p-3 text-xs leading-5 text-[#52615d]">{JSON.stringify(entry.details, null, 2)}</pre>
                )}
              </article>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
