"use client";

import { useMemo, useRef, useState, type SetStateAction } from "react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  FileImage,
  FileJson,
  Images,
  LoaderCircle,
  RefreshCw,
  ScanText,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { MAX_FILE_SIZE } from "@/lib/constants";
import { compressImage, createThumbnail, fileToDataUrl, pdfToImages } from "@/lib/client-images";
import { getActiveVisionAgent, normalizeParallelRequests } from "@/lib/vision-agents";
import { fetchWithFailover, runPromisePool } from "@/lib/recognition-queue";
import { parseRecognitionSession } from "@/lib/recognition-session";
import { extractedRecordResponseSchema } from "@/lib/schemas";
import { FIELD_LABELS, RECORD_FIELDS, type AppSettings, type ExtractedRecord, type RecordField } from "@/lib/types";
import { downloadBlob, readApiResponse, cn } from "@/lib/utils";
import { loggedFetch, logAppError } from "@/lib/app-logs";
import { recordsToCsv } from "@/lib/table-utils";
import { correctBogorodskyAddress } from "@/lib/address-correction";
import { Button, Card, EmptyState, Input, SectionTitle } from "@/components/ui";

type PendingImageStatus = "idle" | "queued" | "processing" | "error";
type PendingImage = {
  id: string;
  name: string;
  dataUrl: string;
  status: PendingImageStatus;
  error?: string;
};

const SESSION_PAGE_SIZE = 25;

export function RecognitionTab({
  settings,
  records,
  onRecordsChange,
  onSendToExcel,
}: {
  settings: AppSettings;
  records: ExtractedRecord[];
  onRecordsChange: (records: SetStateAction<ExtractedRecord[]>) => void;
  onSendToExcel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<PendingImage[]>([]);
  const [dragging, setDragging] = useState(false);
  const [converting, setConverting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [importingJson, setImportingJson] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [sessionPage, setSessionPage] = useState(0);
  const activeVisionAgent = getActiveVisionAgent(settings);
  const sessionPageCount = Math.max(1, Math.ceil(records.length / SESSION_PAGE_SIZE));
  const activeSessionPage = Math.min(sessionPage, sessionPageCount - 1);
  const visibleRecords = useMemo(
    () => records.slice(activeSessionPage * SESSION_PAGE_SIZE, (activeSessionPage + 1) * SESSION_PAGE_SIZE),
    [activeSessionPage, records],
  );

  const addFiles = async (files: File[]) => {
    const valid = files.filter((file) => {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name}: файл больше 20 МБ`);
        return false;
      }
      const accepted = file.type === "application/pdf" || ["image/jpeg", "image/png", "image/webp"].includes(file.type);
      if (!accepted) toast.error(`${file.name}: неподдерживаемый формат`);
      return accepted;
    });
    if (!valid.length) return;
    setConverting(true);
    try {
      const next: PendingImage[] = [];
      for (const file of valid) {
        if (file.type === "application/pdf") {
          const pages = await pdfToImages(file);
          next.push(...pages.map((page) => ({ ...page, id: crypto.randomUUID(), status: "idle" as const })));
        } else {
          next.push({ id: crypto.randomUUID(), name: file.name, dataUrl: await fileToDataUrl(file), status: "idle" });
        }
      }
      setImages((current) => [...current, ...next]);
      toast.success(`Добавлено изображений: ${next.length}`);
    } catch (error) {
      logAppError("Распознавание", error, { action: "Подготовка файлов", requestedCount: valid.length });
      toast.error(error instanceof Error ? error.message : "Не удалось обработать файлы");
    } finally {
      setConverting(false);
    }
  };

  const recognizeImages = async (selectedImages: PendingImage[]) => {
    if (!selectedImages.length || processing) return;
    if (!activeVisionAgent.apiKey) {
      toast.error(`Укажите API-ключ агента «${activeVisionAgent.name}» в настройках`);
      return;
    }

    const selectedIds = new Set(selectedImages.map(({ id }) => id));
    setProcessing(true);
    setProgress({ completed: 0, total: selectedImages.length });
    setImages((current) => current.map((image) => (
      selectedIds.has(image.id)
        ? { ...image, status: "queued", error: undefined }
        : image
    )));

    let successful = 0;
    try {
      await runPromisePool({
        items: selectedImages,
        concurrency: normalizeParallelRequests(settings.parallelRequests),
        task: async (image, index) => {
          setImages((current) => current.map((item) => (
            item.id === image.id ? { ...item, status: "processing", error: undefined } : item
          )));

          let compressed = await compressImage(image.dataUrl);
          if (compressed.length > 11_000_000) {
            compressed = await compressImage(image.dataUrl, 1400, 0.72);
          }
          const response = await fetchWithFailover({
            agents: settings.visionAgents,
            activeAgentId: settings.activeVisionAgentId,
            timeoutSeconds: settings.agentTimeout ?? 60,
            path: "/api/extract",
            method: "POST",
            body: JSON.stringify({ image: compressed, prompt: settings.extractionPrompt }),
            area: "Распознавание",
            action: "Распознавание страницы",
            fetcher: (input, init) => loggedFetch(input, init, {
              area: "Распознавание",
              action: "Распознавание страницы",
              details: { batchPosition: index + 1, batchCount: selectedImages.length },
            }),
          });
          const payload = await readApiResponse<unknown>(response);
          const parsed = extractedRecordResponseSchema.parse(payload);
          const addressCorrection = correctBogorodskyAddress(parsed.address);
          const correctionNote = addressCorrection.changed
            ? `Адрес автоматически исправлен: «${addressCorrection.original}» → «${addressCorrection.value}».`
            : "";
          return {
            ...parsed,
            address: addressCorrection.value,
            confidence_notes: [parsed.confidence_notes, correctionNote].filter(Boolean).join(" "),
            id: crypto.randomUUID(),
            sourceName: image.name,
            thumbnail: await createThumbnail(image.dataUrl),
          } satisfies ExtractedRecord;
        },
        onSettled: (result, image, index) => {
          if (result.status === "fulfilled") {
            successful += 1;
            onRecordsChange((current) => {
              const next = [...current, result.value];
              setSessionPage(Math.floor((next.length - 1) / SESSION_PAGE_SIZE));
              return next;
            });
            setImages((current) => current.filter(({ id }) => id !== image.id));
          } else {
            const message = result.reason instanceof Error
              ? result.reason.message
              : "Неизвестная ошибка распознавания";
            logAppError("Распознавание", result.reason, { action: "Обработка страницы", batchPosition: index + 1, batchCount: selectedImages.length });
            setImages((current) => current.map((item) => (
              item.id === image.id ? { ...item, status: "error", error: message } : item
            )));
          }
          setProgress((current) => ({
            ...current,
            completed: current.completed + 1,
          }));
        },
      });

      if (successful > 0) toast.success(`Распознано документов: ${successful}`);
      const failed = selectedImages.length - successful;
      if (failed > 0) toast.warning(`Не распознано страниц: ${failed}`);
    } finally {
      setProcessing(false);
    }
  };

  const updateRecord = (id: string, field: RecordField, value: string) => {
    onRecordsChange((current) => current.map((record) => (
      record.id === id ? { ...record, [field]: value } : record
    )));
  };

  const exportJson = () => {
    downloadBlob(new Blob([JSON.stringify(records, null, 2)], { type: "application/json" }), "session.json");
  };

  const exportCsv = () => {
    downloadBlob(new Blob([recordsToCsv(records)], { type: "text/csv;charset=utf-8" }), "session.csv");
  };

  const importJson = async (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      toast.error(`${file.name}: JSON больше 20 МБ`);
      return;
    }
    setImportingJson(true);
    try {
      const imported = parseRecognitionSession(JSON.parse(await file.text()), () => crypto.randomUUID());
      onRecordsChange((current) => [...current, ...imported]);
      setSessionPage(Math.floor(records.length / SESSION_PAGE_SIZE));
      toast.success(`Импортировано записей: ${imported.length}`);
    } catch (error) {
      logAppError("Распознавание", error, { action: "Импорт сессии" });
      toast.error("Не удалось импортировать JSON: выберите файл, экспортированный из сессии распознавания");
    } finally {
      setImportingJson(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <SectionTitle title="Загрузка документов" description="JPG, PNG, WebP или PDF до 20 МБ. PDF обрабатывается только в браузере." />
        <div
          className={cn(
            "mt-5 flex min-h-52 flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 text-center transition-colors",
            dragging ? "border-[#23816e] bg-[#edf7f4]" : "border-[#cbd6d2] bg-[#f8faf9]",
          )}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void addFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <UploadCloud className="mb-3 size-9 text-[#448778]" />
          <p className="font-medium">Перетащите файлы сюда</p>
          <p className="mt-1 text-sm text-[#71807b]">или выберите их с устройства</p>
          <Button className="mt-4" variant="secondary" loading={converting} onClick={() => inputRef.current?.click()}>
            <Images className="size-4" /> Выбрать файлы
          </Button>
          <input
            ref={inputRef}
            className="hidden"
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(event) => {
              void addFiles(Array.from(event.target.files ?? []));
              event.currentTarget.value = "";
            }}
          />
        </div>
        {images.length > 0 && (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {images.map((image) => (
                <div
                  className={cn(
                    "group overflow-hidden rounded-md border bg-[#eef2f0]",
                    image.status === "error" ? "border-[#dc7468] bg-[#fff6f4]" : "border-[#d8e2de]",
                  )}
                  key={image.id}
                >
                  <div className="relative aspect-[4/3] overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="h-full w-full object-cover" src={image.dataUrl} alt={image.name} />
                    <div className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-2 py-1 text-xs text-white">{image.name}</div>
                    {(image.status === "queued" || image.status === "processing") && (
                      <div className="absolute inset-0 grid place-items-center bg-[#153c33]/75 text-white">
                        <div className="flex flex-col items-center gap-2 text-xs font-medium">
                          <LoaderCircle className={cn("size-5", image.status === "processing" && "animate-spin")} />
                          {image.status === "processing" ? "Распознавание" : "В очереди"}
                        </div>
                      </div>
                    )}
                    {image.status !== "queued" && image.status !== "processing" && (
                      <button
                        type="button"
                        className="absolute right-1 top-1 rounded bg-white/95 p-1 text-[#33413d] opacity-100 shadow-sm sm:opacity-0 sm:group-hover:opacity-100"
                        title="Удалить изображение"
                        onClick={() => setImages((current) => current.filter(({ id }) => id !== image.id))}
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </div>
                  {image.status === "error" && (
                    <div className="space-y-2 border-t border-[#efb1aa] p-2.5 text-[#8e3028]">
                      <p className="flex items-start gap-1.5 text-xs leading-4">
                        <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                        <span className="break-words">{image.error}</span>
                      </p>
                      <button
                        type="button"
                        disabled={processing}
                        className="inline-flex h-8 items-center gap-1.5 rounded border border-[#d98b82] bg-white px-2.5 text-xs font-medium text-[#8e3028] hover:bg-[#fff0ed] disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => void recognizeImages([image])}
                      >
                        <RefreshCw className="size-3.5" /> Повторить
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <Button loading={processing} onClick={() => void recognizeImages(images)}><ScanText className="size-4" /> Распознать всё</Button>
              {processing && (
                <div className="min-w-52 flex-1">
                  <div className="mb-1 flex justify-between text-xs text-[#65736f]"><span>Завершено</span><span>{progress.completed} из {progress.total}</span></div>
                  <div className="h-2 overflow-hidden rounded bg-[#dce7e3]"><div className="h-full bg-[#23816e] transition-all" style={{ width: `${(progress.completed / progress.total) * 100}%` }} /></div>
                </div>
              )}
            </div>
          </>
        )}
      </Card>

      <Card>
        <div className="border-b border-[#e1e8e5] p-5">
          <SectionTitle
            title={`Сессия распознавания · ${records.length}`}
            description="Поля можно исправить вручную перед передачей в Excel или восстановить из ранее сохранённого JSON."
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" loading={importingJson} onClick={() => jsonInputRef.current?.click()}><UploadCloud className="size-4" /> Импорт JSON</Button>
            <input
              ref={jsonInputRef}
              className="hidden"
              type="file"
              accept=".json,application/json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importJson(file);
                event.currentTarget.value = "";
              }}
            />
            {records.length > 0 && (
              <>
              <Button variant="secondary" onClick={exportJson}><FileJson className="size-4" /> Экспорт JSON</Button>
              <Button variant="secondary" onClick={exportCsv}><Download className="size-4" /> Экспорт CSV</Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (window.confirm("Очистить всю распознанную сессию?")) {
                    onRecordsChange([]);
                    setSessionPage(0);
                  }
                }}
              ><Trash2 className="size-4" /> Очистить сессию</Button>
              <Button className="sm:ml-auto" onClick={onSendToExcel}>Отправить в Excel <ArrowRight className="size-4" /></Button>
              </>
            )}
          </div>
        </div>
        {records.length === 0 ? (
          <EmptyState icon={<FileImage className="size-8" />} title="Сессия пока пуста" text="Загрузите документы и запустите распознавание. Результаты сохранятся в этом браузере." />
        ) : (
          <div className="divide-y divide-[#e4ebe8]">
            {visibleRecords.map((record) => (
              <article className="grid gap-5 p-5 md:grid-cols-[150px_1fr]" key={record.id}>
                <div>
                  {record.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="aspect-[4/3] w-full rounded-md border border-[#dce5e1] object-cover" src={record.thumbnail} alt={record.sourceName} />
                  ) : (
                    <div className="grid aspect-[4/3] w-full place-items-center rounded-md border border-[#dce5e1] bg-[#f4f7f5] text-[#7b8985]">
                      <FileJson className="size-8" />
                    </div>
                  )}
                  <p className="mt-2 break-words text-xs text-[#71807b]">{record.sourceName}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {RECORD_FIELDS.map((field) => (
                    <label className={field === "topic" || field === "address" ? "sm:col-span-2" : ""} key={field}>
                      <span className="mb-1 block text-xs font-medium text-[#60706b]">{FIELD_LABELS[field]}</span>
                      <Input
                        className={record[field].trim() === "-" ? "border-[#e4bd55] bg-[#fff9df]" : ""}
                        value={record[field]}
                        onChange={(event) => updateRecord(record.id, field, event.target.value)}
                      />
                    </label>
                  ))}
                  {record.confidence_notes && (
                    <p className="rounded-md bg-[#fff7df] px-3 py-2 text-sm text-[#725b20] sm:col-span-2">Примечание распознавания: {record.confidence_notes}</p>
                  )}
                </div>
              </article>
            ))}
            {sessionPageCount > 1 && (
              <div className="flex flex-wrap items-center justify-center gap-3 p-4">
                <Button variant="secondary" className="h-9 px-2.5" disabled={activeSessionPage === 0} onClick={() => setSessionPage(activeSessionPage - 1)} title="Предыдущая страница">
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="text-sm text-[#61706b]">Страница {activeSessionPage + 1} из {sessionPageCount}</span>
                <Button variant="secondary" className="h-9 px-2.5" disabled={activeSessionPage >= sessionPageCount - 1} onClick={() => setSessionPage(activeSessionPage + 1)} title="Следующая страница">
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
