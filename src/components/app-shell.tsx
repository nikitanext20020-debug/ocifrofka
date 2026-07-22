"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, FileSpreadsheet, ScanLine, ScrollText, Settings2, ShieldCheck } from "lucide-react";
import { Toaster, toast } from "sonner";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import { compactRecordsForStorage } from "@/lib/recognition-session";
import type { AppSettings, ExtractedRecord } from "@/lib/types";
import { normalizeSettings } from "@/lib/vision-agents";
import {
  hasRestorableSettingsBackup,
  resetCorruptedSettings,
  restoreSettingsBackup,
  SETTINGS_STORAGE_KEY,
  useLocalStorage,
} from "@/lib/use-local-storage";
import { useIndexedDbStorage } from "@/lib/use-indexed-db-storage";
import { cn } from "@/lib/utils";
import { appendAppLog, logAppError } from "@/lib/app-logs";
import { ExcelTab } from "@/components/excel-tab";
import { LogsTab } from "@/components/logs-tab";
import { RecognitionTab } from "@/components/recognition-tab";
import { SettingsTab } from "@/components/settings-tab";

type Tab = "recognition" | "excel" | "logs" | "settings";

const EMPTY_RECORDS: ExtractedRecord[] = [];

const TABS = [
  { id: "recognition" as const, label: "Распознавание", icon: ScanLine },
  { id: "excel" as const, label: "Excel", icon: FileSpreadsheet },
  { id: "logs" as const, label: "Логи", icon: ScrollText },
  { id: "settings" as const, label: "Настройки", icon: Settings2 },
];

export function AppShell() {
  const [tab, setTab] = useState<Tab>("recognition");
  const [storageFailure, setStorageFailure] = useState<string | null>(null);
  const [settingsParseError, setSettingsParseError] = useState(false);
  const [canRestoreSettings, setCanRestoreSettings] = useState(false);
  const [settings, setSettings] = useLocalStorage<AppSettings>(
    "digitizer-settings",
    DEFAULT_SETTINGS,
    undefined,
    1,
    normalizeSettings,
  );
  const [records, setRecords, recordsReady] = useIndexedDbStorage<ExtractedRecord[]>(
    "digitizer-session",
    EMPTY_RECORDS,
    compactRecordsForStorage,
  );
  const [queue, setQueue, queueReady] = useIndexedDbStorage<ExtractedRecord[]>(
    "digitizer-excel-queue",
    EMPTY_RECORDS,
    compactRecordsForStorage,
  );

  useEffect(() => {
    const inspectSettings = () => {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw === null) return;
      try {
        JSON.parse(raw);
      } catch {
        setSettingsParseError(true);
        setCanRestoreSettings(hasRestorableSettingsBackup());
      }
    };
    const handleWriteError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setStorageFailure(detail?.message || "Браузер отклонил запись данных.");
    };
    const handleWriteSuccess = () => setStorageFailure(null);
    const handleParseError = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; canRestore?: boolean }>).detail;
      if (detail?.key !== SETTINGS_STORAGE_KEY) return;
      setSettingsParseError(true);
      setCanRestoreSettings(Boolean(detail.canRestore));
    };
    inspectSettings();
    window.addEventListener("storage-write-error", handleWriteError);
    window.addEventListener("storage-write-success", handleWriteSuccess);
    window.addEventListener("storage-parse-error", handleParseError);
    return () => {
      window.removeEventListener("storage-write-error", handleWriteError);
      window.removeEventListener("storage-write-success", handleWriteSuccess);
      window.removeEventListener("storage-parse-error", handleParseError);
    };
  }, []);

  const recoverSettings = () => {
    const restored = restoreSettingsBackup();
    if (!restored) {
      setStorageFailure("Не удалось восстановить резервную копию настроек.");
      return;
    }
    setSettingsParseError(false);
    toast.success("Настройки восстановлены из резервной копии");
  };

  const resetSettings = () => {
    const reset = resetCorruptedSettings(DEFAULT_SETTINGS, 1);
    if (!reset) {
      setStorageFailure("Не удалось сохранить стандартные настройки.");
      return;
    }
    setSettingsParseError(false);
    toast.success("Сохранены стандартные настройки");
  };

  useEffect(() => {
    appendAppLog({
      level: "info",
      area: "Приложение",
      message: "Страница открыта",
      details: { path: location.pathname, online: navigator.onLine },
    });
    const handleError = (event: ErrorEvent) => logAppError("Браузер", event.error ?? event.message);
    const handleRejection = (event: PromiseRejectionEvent) => logAppError("Браузер", event.reason);
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  useEffect(() => {
    const normalized = normalizeSettings(settings);
    if (JSON.stringify(normalized) !== JSON.stringify(settings)) setSettings(normalized);
  }, [setSettings, settings]);

  const sendToExcel = () => {
    if (!records.length) return;
    setQueue(records);
    setTab("excel");
    toast.success(`В Excel передано записей: ${records.length}`);
  };

  return (
    <div className="min-h-screen bg-[#f4f7f5] text-[#192622]">
      <header className="border-b border-[#dce5e1] bg-white">
        <div className="mx-auto flex max-w-[1540px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-md bg-[#176b5b] text-white">
              <ScanLine className="size-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Оцифровка обращений</h1>
              <p className="text-xs text-[#74817d]">Фото и документы в структурированный Excel</p>
            </div>
          </div>
          <div className="inline-flex items-center gap-2 self-start rounded-md border border-[#dfe7e4] bg-[#f8faf9] px-3 py-2 text-xs text-[#5e6c68] lg:self-auto">
            <ShieldCheck className="size-4 text-[#287462]" /> Ключи: браузер или защищённые переменные сервера
          </div>
        </div>
        <nav className="mx-auto flex max-w-[1540px] gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8" aria-label="Разделы приложения">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "relative flex h-12 shrink-0 items-center gap-2 px-4 text-sm font-medium text-[#687671] transition-colors hover:text-[#24423a]",
                tab === id && "text-[#176b5b] after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-[#176b5b]",
              )}
            >
              <Icon className="size-4" /> {label}
              {id === "excel" && queue.length > 0 && (
                <span className="grid min-w-5 place-items-center rounded-full bg-[#dff1eb] px-1.5 text-[11px] text-[#176b5b]">{queue.length}</span>
              )}
            </button>
          ))}
        </nav>
      </header>

      {(storageFailure || settingsParseError) && (
        <div className="sticky top-0 z-50 border-b border-red-300 bg-red-50 px-4 py-3 text-red-900" role="alert" aria-live="assertive">
          <div className="mx-auto flex max-w-[1540px] flex-wrap items-center gap-3">
            <AlertTriangle className="size-5 shrink-0" />
            <strong>{storageFailure ? "Настройки НЕ сохранены" : "Настройки повреждены и не были перезаписаны"}</strong>
            <span className="text-sm">{storageFailure || "Можно восстановить последнюю резервную копию или явно сбросить настройки."}</span>
            {settingsParseError && canRestoreSettings && (
              <button type="button" className="rounded-md border border-red-400 bg-white px-3 py-1.5 text-sm font-medium" onClick={recoverSettings}>Восстановить копию</button>
            )}
            {settingsParseError && (
              <button type="button" className="rounded-md border border-red-400 bg-white px-3 py-1.5 text-sm font-medium" onClick={resetSettings}>Сбросить настройки</button>
            )}
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-[1540px] px-4 py-6 sm:px-6 lg:px-8">
        {!recordsReady || !queueReady ? (
          <div className="rounded-md border border-[#dce5e1] bg-white p-8 text-center text-sm text-[#687671]">Загрузка сохранённой сессии…</div>
        ) : (
          <>
            <div hidden={tab !== "recognition"}>
              <RecognitionTab settings={settings} records={records} onRecordsChange={setRecords} onSendToExcel={sendToExcel} />
            </div>
            <div hidden={tab !== "excel"}>
              <ExcelTab settings={settings} queue={queue} onQueueConsumed={() => setQueue([])} />
            </div>
            <div hidden={tab !== "logs"}>
              <LogsTab />
            </div>
            <div hidden={tab !== "settings"}>
              <SettingsTab settings={settings} onChange={setSettings} />
            </div>
          </>
        )}
      </main>
      <Toaster richColors position="top-right" closeButton />
    </div>
  );
}
