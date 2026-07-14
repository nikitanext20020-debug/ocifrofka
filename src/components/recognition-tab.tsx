"use client";

import { useRef, useState } from "react";
import {
  ArrowRight,
  Download,
  FileImage,
  FileJson,
  Images,
  ScanText,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { MAX_FILE_SIZE } from "@/lib/constants";
import { compressImage, createThumbnail, fileToDataUrl, pdfToImages } from "@/lib/client-images";
import { getActiveVisionAgent } from "@/lib/vision-agents";
import { extractedRecordResponseSchema } from "@/lib/schemas";
import { FIELD_LABELS, RECORD_FIELDS, type AppSettings, type ExtractedRecord, type RecordField } from "@/lib/types";
import { downloadBlob, agentHeaders, readApiResponse, cn } from "@/lib/utils";
import { recordsToCsv } from "@/lib/table-utils";
import { Button, Card, EmptyState, Input, SectionTitle } from "@/components/ui";

type PendingImage = { id: string; name: string; dataUrl: string };

export function RecognitionTab({
  settings,
  records,
  onRecordsChange,
  onSendToExcel,
}: {
  settings: AppSettings;
  records: ExtractedRecord[];
  onRecordsChange: (records: ExtractedRecord[]) => void;
  onSendToExcel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<PendingImage[]>([]);
  const [dragging, setDragging] = useState(false);
  const [converting, setConverting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const activeVisionAgent = getActiveVisionAgent(settings);

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
          next.push(...pages.map((page) => ({ ...page, id: crypto.randomUUID() })));
        } else {
          next.push({ id: crypto.randomUUID(), name: file.name, dataUrl: await fileToDataUrl(file) });
        }
      }
      setImages((current) => [...current, ...next]);
      toast.success(`Добавлено изображений: ${next.length}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обработать файлы");
    } finally {
      setConverting(false);
    }
  };

  const recognize = async () => {
    if (!images.length) return;
    if (!activeVisionAgent.apiKey) {
      toast.error(`Укажите API-ключ агента «${activeVisionAgent.name}» в настройках`);
      return;
    }
    setProcessing(true);
    setProgress({ current: 0, total: images.length });
    const successfulIds = new Set<string>();
    const recognized: ExtractedRecord[] = [];
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      setProgress({ current: index + 1, total: images.length });
      try {
        let compressed = await compressImage(image.dataUrl);
        if (compressed.length > 11_000_000) compressed = await compressImage(image.dataUrl, 1400, 0.72);
        const payload = await readApiResponse<unknown>(
          await fetch("/api/extract", {
            method: "POST",
            headers: agentHeaders(activeVisionAgent),
            body: JSON.stringify({ image: compressed, prompt: settings.extractionPrompt }),
          }),
        );
        const parsed = extractedRecordResponseSchema.parse(payload);
        recognized.push({
          ...parsed,
          id: crypto.randomUUID(),
          sourceName: image.name,
          thumbnail: await createThumbnail(image.dataUrl),
        });
        successfulIds.add(image.id);
      } catch (error) {
        toast.error(`${image.name}: ${error instanceof Error ? error.message : "ошибка распознавания"}`);
      }
    }
    if (recognized.length) {
      onRecordsChange([...records, ...recognized]);
      setImages((current) => current.filter((image) => !successfulIds.has(image.id)));
      toast.success(`Распознано документов: ${recognized.length}`);
    }
    setProcessing(false);
  };

  const updateRecord = (id: string, field: RecordField, value: string) => {
    onRecordsChange(records.map((record) => (record.id === id ? { ...record, [field]: value } : record)));
  };

  const exportJson = () => {
    downloadBlob(new Blob([JSON.stringify(records, null, 2)], { type: "application/json" }), "session.json");
  };

  const exportCsv = () => {
    downloadBlob(new Blob([recordsToCsv(records)], { type: "text/csv;charset=utf-8" }), "session.csv");
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
                <div className="group relative aspect-[4/3] overflow-hidden rounded-md border border-[#d8e2de] bg-[#eef2f0]" key={image.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="h-full w-full object-cover" src={image.dataUrl} alt={image.name} />
                  <div className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-2 py-1 text-xs text-white">{image.name}</div>
                  <button
                    className="absolute right-1 top-1 rounded bg-white/95 p-1 text-[#33413d] opacity-100 shadow-sm sm:opacity-0 sm:group-hover:opacity-100"
                    title="Удалить изображение"
                    onClick={() => setImages((current) => current.filter(({ id }) => id !== image.id))}
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <Button loading={processing} onClick={recognize}><ScanText className="size-4" /> Распознать всё</Button>
              {processing && (
                <div className="min-w-52 flex-1">
                  <div className="mb-1 flex justify-between text-xs text-[#65736f]"><span>Обработка</span><span>{progress.current} из {progress.total}</span></div>
                  <div className="h-2 overflow-hidden rounded bg-[#dce7e3]"><div className="h-full bg-[#23816e] transition-all" style={{ width: `${(progress.current / progress.total) * 100}%` }} /></div>
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
            description="Поля можно исправить вручную перед передачей в Excel."
          />
          {records.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={exportJson}><FileJson className="size-4" /> Экспорт JSON</Button>
              <Button variant="secondary" onClick={exportCsv}><Download className="size-4" /> Экспорт CSV</Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (window.confirm("Очистить всю распознанную сессию?")) onRecordsChange([]);
                }}
              ><Trash2 className="size-4" /> Очистить сессию</Button>
              <Button className="sm:ml-auto" onClick={onSendToExcel}>Отправить в Excel <ArrowRight className="size-4" /></Button>
            </div>
          )}
        </div>
        {records.length === 0 ? (
          <EmptyState icon={<FileImage className="size-8" />} title="Сессия пока пуста" text="Загрузите документы и запустите распознавание. Результаты сохранятся в этом браузере." />
        ) : (
          <div className="divide-y divide-[#e4ebe8]">
            {records.map((record) => (
              <article className="grid gap-5 p-5 md:grid-cols-[150px_1fr]" key={record.id}>
                <div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="aspect-[4/3] w-full rounded-md border border-[#dce5e1] object-cover" src={record.thumbnail} alt={record.sourceName} />
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
                    <p className="rounded-md bg-[#fff7df] px-3 py-2 text-sm text-[#725b20] sm:col-span-2">Неуверенно: {record.confidence_notes}</p>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
