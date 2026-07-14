"use client";

import { useEffect, useState } from "react";
import { FileSpreadsheet, ScanLine, Settings2, ShieldCheck } from "lucide-react";
import { Toaster, toast } from "sonner";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import type { AppSettings, ExtractedRecord } from "@/lib/types";
import { normalizeSettings } from "@/lib/vision-agents";
import { useLocalStorage } from "@/lib/use-local-storage";
import { cn } from "@/lib/utils";
import { ExcelTab } from "@/components/excel-tab";
import { RecognitionTab } from "@/components/recognition-tab";
import { SettingsTab } from "@/components/settings-tab";

type Tab = "recognition" | "excel" | "settings";

const EMPTY_RECORDS: ExtractedRecord[] = [];

const TABS = [
  { id: "recognition" as const, label: "Распознавание", icon: ScanLine },
  { id: "excel" as const, label: "Excel", icon: FileSpreadsheet },
  { id: "settings" as const, label: "Настройки", icon: Settings2 },
];

export function AppShell() {
  const [tab, setTab] = useState<Tab>("recognition");
  const [settings, setSettings] = useLocalStorage<AppSettings>("digitizer-settings", DEFAULT_SETTINGS);
  const [records, setRecords] = useLocalStorage<ExtractedRecord[]>("digitizer-session", EMPTY_RECORDS);
  const [queue, setQueue] = useLocalStorage<ExtractedRecord[]>("digitizer-excel-queue", EMPTY_RECORDS);

  useEffect(() => {
    const handleQuota = () => toast.error("Хранилище браузера заполнено. Экспортируйте сессию и удалите часть записей.");
    window.addEventListener("storage-quota-error", handleQuota);
    return () => window.removeEventListener("storage-quota-error", handleQuota);
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
            <ShieldCheck className="size-4 text-[#287462]" /> API-ключи хранятся только в браузере
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

      <main className="mx-auto w-full max-w-[1540px] px-4 py-6 sm:px-6 lg:px-8">
        <div hidden={tab !== "recognition"}>
          <RecognitionTab settings={settings} records={records} onRecordsChange={setRecords} onSendToExcel={sendToExcel} />
        </div>
        <div hidden={tab !== "excel"}>
          <ExcelTab settings={settings} queue={queue} onQueueConsumed={() => setQueue([])} />
        </div>
        <div hidden={tab !== "settings"}>
          <SettingsTab settings={settings} onChange={setSettings} />
        </div>
      </main>
      <Toaster richColors position="top-right" closeButton />
    </div>
  );
}
