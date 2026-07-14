"use client";

import { useMemo, useRef, useState } from "react";
import {
  Bot,
  Download,
  FileSpreadsheet,
  ListChecks,
  PlusCircle,
  Redo2,
  Sparkles,
  Upload,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  applyCellChanges,
  findGapCells,
  findInsertRow,
  mergeRecordsAt,
  normalizeTable,
  recordForApi,
} from "@/lib/table-utils";
import {
  FIELD_LABELS,
  RECORD_FIELDS,
  type AppSettings,
  type CellChange,
  type CellMarks,
  type ColumnMapping,
  type ExtractedRecord,
  type RecordField,
  type TableAnalysis,
  type TableSnapshot,
  type WorkbookData,
} from "@/lib/types";
import { agentHeaders, clone, cn, readApiResponse } from "@/lib/utils";
import { Button, Card, EmptyState, SectionTitle } from "@/components/ui";

const BATCH_SIZE = 30;
const PARALLEL_REQUESTS = 3;

async function runBatches<T>(tasks: Array<() => Promise<T[]>>) {
  const results: T[] = [];
  const errors: Error[] = [];
  for (let i = 0; i < tasks.length; i += PARALLEL_REQUESTS) {
    const settled = await Promise.allSettled(tasks.slice(i, i + PARALLEL_REQUESTS).map((task) => task()));
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") results.push(...outcome.value);
      else errors.push(outcome.reason instanceof Error ? outcome.reason : new Error(String(outcome.reason)));
    }
  }
  return { results, errors };
}

type BusyAction = "load" | "analyze" | "insert" | "gaps" | "custom" | null;

export function ExcelTab({
  settings,
  queue,
  onQueueConsumed,
}: {
  settings: AppSettings;
  queue: ExtractedRecord[];
  onQueueConsumed: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [workbook, setWorkbook] = useState<WorkbookData | null>(null);
  const [analysis, setAnalysis] = useState<TableAnalysis | null>(null);
  const [insertRow, setInsertRow] = useState<number | null>(null);
  const [marks, setMarks] = useState<CellMarks>({});
  const [newRows, setNewRows] = useState<number[]>([]);
  const [history, setHistory] = useState<TableSnapshot[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState<BusyAction>(null);

  const table = workbook ? workbook.sheets[workbook.activeSheet] : null;
  const mappedCount = analysis
    ? Object.values(analysis.mapping).filter((value) => value !== null).length
    : 0;

  const pushSnapshot = () => {
    if (!workbook) return;
    setHistory((current) => [
      ...current.slice(-9),
      { workbook: clone(workbook), marks: clone(marks), newRows: [...newRows], notice },
    ]);
  };

  const replaceActiveRows = (rows: unknown[][]) => {
    if (!workbook) return;
    setWorkbook({
      ...workbook,
      sheets: {
        ...workbook.sheets,
        [workbook.activeSheet]: { ...workbook.sheets[workbook.activeSheet], rows },
      },
    });
  };

  const loadWorkbook = async (file: File) => {
    setBusy("load");
    try {
      const XLSX = await import("xlsx");
      const parsed = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const sheets = Object.fromEntries(
        parsed.SheetNames.map((name) => {
          const matrix = XLSX.utils.sheet_to_json<unknown[]>(parsed.Sheets[name], {
            header: 1,
            raw: false,
            defval: "",
          });
          return [name, normalizeTable(matrix)];
        }),
      );
      const next = {
        fileName: file.name,
        activeSheet: parsed.SheetNames[0] ?? "Лист 1",
        sheetOrder: parsed.SheetNames.length ? parsed.SheetNames : ["Лист 1"],
        sheets: parsed.SheetNames.length ? sheets : { "Лист 1": { headers: [], rows: [] } },
      };
      setWorkbook(next);
      setAnalysis(null);
      setInsertRow(null);
      setMarks({});
      setNewRows([]);
      setHistory([]);
      setNotice(null);
      toast.success("Таблица загружена");
    } catch {
      toast.error("Не удалось прочитать файл таблицы");
    } finally {
      setBusy(null);
    }
  };

  const downloadWorkbook = async () => {
    if (!workbook) return;
    const XLSX = await import("xlsx");
    const output = XLSX.utils.book_new();
    for (const sheetName of workbook.sheetOrder) {
      const sheet = workbook.sheets[sheetName];
      XLSX.utils.book_append_sheet(
        output,
        XLSX.utils.aoa_to_sheet([sheet.headers, ...sheet.rows]),
        sheetName,
      );
    }
    const baseName = workbook.fileName.replace(/\.(xlsx|xls|csv)$/i, "");
    XLSX.writeFile(output, `${baseName}-обработано.xlsx`);
  };

  const analyze = async () => {
    if (!table || !table.headers.length) return;
    setBusy("analyze");
    try {
      const rows = table.rows
        .filter((row) => row.some((cell) => String(cell ?? "").trim()))
        .slice(0, 20);
      const result = await readApiResponse<{ mapping: ColumnMapping; formats: Record<RecordField, string> }>(
        await fetch("/api/table/analyze", {
          method: "POST",
          headers: agentHeaders(settings.table),
          body: JSON.stringify({ headers: table.headers, rows }),
        }),
      );
      // Compute categoricals client-side from ALL rows (no model needed)
      const categoricals: Record<number, string[]> = {};
      table.headers.forEach((_, colIndex) => {
        const valueSet = new Set<string>();
        for (const row of table.rows) {
          const val = String(row[colIndex] ?? "").trim();
          if (val && val !== "-") valueSet.add(val);
        }
        if (valueSet.size >= 2 && valueSet.size <= 30) {
          categoricals[colIndex] = [...valueSet].sort();
        }
      });
      const fullResult: TableAnalysis = { ...result, categoricals };
      setAnalysis(fullResult);
      setInsertRow(findInsertRow(table, result.mapping));
      toast.success("Структура таблицы определена");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось проанализировать таблицу");
    } finally {
      setBusy(null);
    }
  };

  const insertRecords = async () => {
    if (!table || !analysis || !queue.length || !workbook) return;
    setBusy("insert");
    try {
      // Build per-field categoricals: only for mapped columns that are categorical
      const fieldCategoricals: Record<string, string[]> = {};
      for (const field of RECORD_FIELDS) {
        const col = analysis.mapping[field];
        if (col !== null && analysis.categoricals[col]) {
          fieldCategoricals[field] = analysis.categoricals[col];
        }
      }

      const normalized: Array<Record<(typeof RECORD_FIELDS)[number], string>> = [];
      for (let start = 0; start < queue.length; start += BATCH_SIZE) {
        const batch = queue.slice(start, start + BATCH_SIZE).map(recordForApi);
        const result = await readApiResponse<{ records: typeof normalized }>(
          await fetch("/api/table/insert", {
            method: "POST",
            headers: agentHeaders(settings.table),
            body: JSON.stringify({ records: batch, formats: analysis.formats, categoricals: fieldCategoricals }),
          }),
        );
        normalized.push(...result.records);
      }

      const startIndex = insertRow ?? findInsertRow(table, analysis.mapping);
      pushSnapshot();
      const { rows: updatedRows, writtenRows } = mergeRecordsAt(table, normalized, analysis.mapping, startIndex);
      replaceActiveRows(updatedRows);
      setNewRows(writtenRows);
      setMarks({});

      if (writtenRows.length > 0) {
        const startExcel = writtenRows[0] + 2;
        const endExcel = writtenRows[writtenRows.length - 1] + 2;
        const skipped = normalized.length - writtenRows.length;
        let noticeText = `Добавлены строки ${startExcel}–${endExcel}`;
        if (skipped > 0) noticeText += ` · ${skipped} не вошли (конец листа)`;
        setNotice(noticeText);
      } else {
        setNotice("Нет строк для вставки: достигнут конец листа");
      }
      onQueueConsumed();
      toast.success(`Добавлено строк: ${writtenRows.length}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось вставить записи");
    } finally {
      setBusy(null);
    }
  };

  const fillGaps = async () => {
    if (!table || !analysis) return;
    const gaps = findGapCells(table, analysis.mapping);
    if (!gaps.length) {
      toast.info("В замаппированных колонках нет пропусков");
      return;
    }
    setBusy("gaps");
    try {
      // Build column-header-level categoricals for fill-gaps prompt
      const columnCategoricals: Record<string, string[]> = {};
      for (const [colIdx, values] of Object.entries(analysis.categoricals)) {
        const headerName = table.headers[Number(colIdx)];
        if (headerName) columnCategoricals[headerName] = values;
      }
      const examples = table.rows
        .filter((row) => Object.values(analysis.mapping).every((column) => column === null || String(row[column] ?? "").trim()))
        .slice(0, 10);
      const groupedRows = [...new Set(gaps.map(({ row }) => row))];
      const tasks: Array<() => Promise<CellChange[]>> = [];
      for (let start = 0; start < groupedRows.length; start += BATCH_SIZE) {
        const rowIndexes = groupedRows.slice(start, start + BATCH_SIZE);
        const rowSet = new Set(rowIndexes);
        const batchGaps = gaps.filter(({ row }) => rowSet.has(row));
        tasks.push(async () => {
          const result = await readApiResponse<{ changes: CellChange[] }>(
            await fetch("/api/table/fill-gaps", {
              method: "POST",
              headers: agentHeaders(settings.table),
              body: JSON.stringify({
                headers: table.headers,
                rows: rowIndexes.map((row) => ({ row, values: table.rows[row] })),
                gaps: batchGaps,
                examples,
                formats: analysis.formats,
                categoricals: columnCategoricals,
              }),
            }),
          );
          return result.changes;
        });
      }
      const { results: changes, errors } = await runBatches(tasks);
      const allowed = new Set(gaps.map(({ row, column }) => `${row}:${column}`));
      const applied = applyCellChanges(table.rows, changes, allowed);
      if (!applied.applied.length) {
        throw errors[0] ?? new Error("Модель не предложила значений для пропусков");
      }
      if (errors.length) {
        toast.warning(`Часть батчей не обработана (${errors.length}). Нажмите «Дополнить пропуски» ещё раз для оставшихся ячеек.`);
      }
      pushSnapshot();
      replaceActiveRows(applied.rows);
      setMarks(Object.fromEntries(applied.applied.map(({ row, column }) => [`${row}:${column}`, "generated"] as const)));
      setNewRows([]);
      setNotice(`Сгенерировано значений: ${applied.applied.length}`);
      toast.success(`Заполнено ячеек: ${applied.applied.length}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось заполнить пропуски");
    } finally {
      setBusy(null);
    }
  };

  const applyInstruction = async () => {
    if (!table || !analysis || instruction.trim().length < 3) return;
    setBusy("custom");
    try {
      const tasks: Array<() => Promise<CellChange[]>> = [];
      for (let start = 0; start < table.rows.length; start += BATCH_SIZE) {
        const rows = table.rows.slice(start, start + BATCH_SIZE).map((values, index) => ({ row: start + index, values }));
        tasks.push(async () => {
          const result = await readApiResponse<{ changes: CellChange[] }>(
            await fetch("/api/table/custom", {
              method: "POST",
              headers: agentHeaders(settings.table),
              body: JSON.stringify({ instruction: instruction.trim(), headers: table.headers, rows }),
            }),
          );
          return result.changes;
        });
      }
      const { results: changes, errors } = await runBatches(tasks);
      if (errors.length && !changes.length) throw errors[0];
      if (errors.length) {
        toast.warning(`Часть батчей не обработана (${errors.length}). Запустите инструкцию повторно.`);
      }
      const applied = applyCellChanges(table.rows, changes);
      if (!applied.applied.length) {
        toast.info("Инструкция не потребовала изменений");
        return;
      }
      pushSnapshot();
      replaceActiveRows(applied.rows);
      setMarks(Object.fromEntries(applied.applied.map(({ row, column }) => [`${row}:${column}`, "custom"] as const)));
      setNewRows([]);
      setNotice(`Изменено ячеек: ${applied.applied.length}`);
      toast.success(`Применено изменений: ${applied.applied.length}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось применить инструкцию");
    } finally {
      setBusy(null);
    }
  };

  const undo = () => {
    const snapshot = history.at(-1);
    if (!snapshot) return;
    setWorkbook(snapshot.workbook);
    setMarks(snapshot.marks);
    setNewRows(snapshot.newRows);
    setNotice(snapshot.notice);
    setHistory((current) => current.slice(0, -1));
    toast.success("Последнее действие отменено");
  };

  const columnOptions = useMemo(
    () => table?.headers.map((header, index) => ({ index, label: `${header} · ${index + 1}` })) ?? [],
    [table?.headers],
  );

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <SectionTitle
          title="Таблица Excel"
          description="Файл разбирается и изменяется в браузере. Исходник остаётся без изменений."
          action={
            <div className="flex flex-wrap gap-2">
              {workbook && <Button variant="secondary" onClick={undo} disabled={!history.length}><Redo2 className="size-4 -scale-x-100" /> Отменить последнее действие</Button>}
              {workbook && <Button variant="secondary" onClick={downloadWorkbook}><Download className="size-4" /> Скачать .xlsx</Button>}
              <Button loading={busy === "load"} onClick={() => inputRef.current?.click()}><Upload className="size-4" /> Загрузить таблицу</Button>
              <input
                ref={inputRef}
                className="hidden"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void loadWorkbook(file);
                  event.currentTarget.value = "";
                }}
              />
            </div>
          }
        />
      </Card>

      {!workbook || !table ? (
        <Card><EmptyState icon={<FileSpreadsheet className="size-9" />} title="Загрузите таблицу" text="Поддерживаются XLSX, XLS и CSV. После загрузки появятся просмотр и действия Excel-агента." /></Card>
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e0e8e5] p-4">
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="size-5 text-[#287462]" />
                <span className="max-w-64 truncate text-sm font-medium">{workbook.fileName}</span>
              </div>
              {workbook.sheetOrder.length > 1 && (
                <label className="flex items-center gap-2 text-sm">
                  Лист
                  <select
                    className="h-9 rounded-md border border-[#cbd6d2] bg-white px-3"
                    value={workbook.activeSheet}
                    onChange={(event) => {
                      setWorkbook({ ...workbook, activeSheet: event.target.value });
                      setAnalysis(null); setInsertRow(null); setMarks({}); setNewRows([]); setHistory([]); setNotice(null);
                    }}
                  >
                    {workbook.sheetOrder.map((name) => <option key={name}>{name}</option>)}
                  </select>
                </label>
              )}
            </div>
            {table.headers.length === 0 ? (
              <EmptyState icon={<ListChecks className="size-8" />} title="Лист пуст" text="Выберите другой лист или загрузите файл с заголовками." />
            ) : (
              <div className="max-h-[560px] overflow-auto">
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-[#edf3f0] text-[#33423e]">
                    <tr>
                      <th className="w-14 border-b border-r border-[#d3ded9] px-3 py-2 text-center font-medium">#</th>
                      {table.headers.map((header, index) => (
                        <th className="min-w-40 border-b border-r border-[#d3ded9] px-3 py-2 font-semibold" key={`${header}-${index}`}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row, rowIndex) => (
                      <tr className={cn("border-b border-[#e5ebe8]", newRows.includes(rowIndex) && "bg-[#e8f7ee]")} key={rowIndex}>
                        <td className="border-r border-[#e0e7e4] px-3 py-2 text-center text-xs text-[#7b8985]">{rowIndex + 2}</td>
                        {table.headers.map((_, columnIndex) => {
                          const mark = marks[`${rowIndex}:${columnIndex}`];
                          return (
                            <td
                              className={cn(
                                "max-w-80 border-r border-[#e0e7e4] px-3 py-2 align-top text-[#293733]",
                                mark === "generated" && "bg-[#fff0d5]",
                                mark === "custom" && "bg-[#e8f1ff]",
                              )}
                              key={columnIndex}
                            >
                              <div className="break-words">{String(row[columnIndex] ?? "") || <span className="text-[#a3ada9]">пусто</span>}</div>
                              {mark === "generated" && <span className="mt-1 inline-flex text-[10px] font-semibold uppercase text-[#97651d]">сгенерировано</span>}
                              {mark === "custom" && <span className="mt-1 inline-flex text-[10px] font-semibold uppercase text-[#37689a]">изменено</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="border-t border-[#e0e8e5] px-4 py-3 text-sm text-[#61706b]">Всего строк: {table.rows.length}</div>
          </Card>

          {table.headers.length > 0 && (
            <Card className="p-5">
              <SectionTitle title="Действия Excel-агента" description="Модель возвращает только список изменений; таблица изменяется локально." />
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <Button loading={busy === "analyze"} onClick={analyze}><Bot className="size-4" /> Проанализировать таблицу</Button>
                <Button variant="secondary" loading={busy === "insert"} disabled={!analysis || !queue.length} onClick={insertRecords}><PlusCircle className="size-4" /> Занести данные из распознавания {queue.length ? `· ${queue.length}` : ""}</Button>
                {analysis && insertRow !== null && (
                  <label className="flex items-center gap-1.5 text-sm text-[#61706b]">
                    со строки:
                    <input
                      id="insert-row-input"
                      type="number"
                      min={2}
                      max={table.rows.length + 1}
                      className="h-9 w-20 rounded-md border border-[#cbd6d2] bg-white px-2 text-center text-sm outline-none focus:border-[#23816e] focus:ring-2 focus:ring-[#23816e]/15"
                      value={insertRow + 2}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (!isNaN(v)) setInsertRow(Math.max(0, Math.min(table.rows.length, v - 2)));
                      }}
                    />
                  </label>
                )}
                <Button variant="secondary" loading={busy === "gaps"} disabled={!analysis} onClick={fillGaps}><Sparkles className="size-4" /> Дополнить пропуски</Button>
              </div>
              {!analysis && <p className="mt-3 text-sm text-[#806b32]">Сначала проанализируйте таблицу, чтобы определить колонки и форматы.</p>}
              {notice && <div className="mt-4 rounded-md border border-[#b9dfd3] bg-[#edf8f4] px-4 py-3 text-sm font-medium text-[#1e6958]">{notice}</div>}
            </Card>
          )}

          {analysis && (
            <Card className="p-5">
              <SectionTitle title={`Маппинг колонок · ${mappedCount} из 5`} description="Проверьте соответствие и при необходимости выберите колонки вручную." />
              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {RECORD_FIELDS.map((field) => (
                  <label key={field}>
                    <span className="mb-1.5 block text-sm font-medium">{FIELD_LABELS[field]}</span>
                    <select
                      className="h-10 w-full rounded-md border border-[#cbd6d2] bg-white px-3 text-sm"
                      value={analysis.mapping[field] ?? ""}
                      onChange={(event) => setAnalysis({
                        ...analysis,
                        mapping: { ...analysis.mapping, [field]: event.target.value === "" ? null : Number(event.target.value) } as ColumnMapping,
                      })}
                    >
                      <option value="">Не определено</option>
                      {columnOptions.map(({ index, label }) => <option value={index} key={index}>{label}</option>)}
                    </select>
                    <p className="mt-1.5 text-xs leading-5 text-[#71807b]">{analysis.formats[field] || "Формат не определён"}</p>
                  </label>
                ))}
              </div>
              {Object.keys(analysis.categoricals).length > 0 && (
                <div className="mt-5 border-t border-[#e0e8e5] pt-5">
                  <p className="mb-3 text-sm font-semibold text-[#33423e]">Категориальные колонки <span className="ml-1 font-normal text-[#71807b]">(модель будет выбирать значения строго из списка)</span></p>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {Object.entries(analysis.categoricals).map(([colIdx, values]) => (
                      <div key={colIdx} className="rounded-md border border-[#d9e4e0] bg-[#f7faf8] p-3">
                        <p className="mb-2 text-xs font-semibold text-[#3a5450]">{table.headers[Number(colIdx)] ?? `Колонка ${Number(colIdx) + 1}`}</p>
                        <div className="flex flex-wrap gap-1">
                          {values.map((v) => (
                            <span key={v} className="rounded-full bg-[#e0f0ea] px-2 py-0.5 text-xs text-[#1e6958]">{v}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}

          <Card className="p-5">
            <SectionTitle title="Своя инструкция" description="Для больших таблиц строки отправляются агенту батчами по 100." />
            <div className="mt-4 flex flex-col gap-3 lg:flex-row">
              <textarea
                className="min-h-24 flex-1 resize-y rounded-md border border-[#cbd6d2] p-3 text-sm outline-none focus:border-[#23816e] focus:ring-2 focus:ring-[#23816e]/15"
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="Например: везде, где тема состоит из одного слова, разверни её в осмысленную фразу"
                disabled={!analysis}
              />
              <Button className="lg:self-end" loading={busy === "custom"} disabled={!analysis || instruction.trim().length < 3} onClick={applyInstruction}><WandSparkles className="size-4" /> Применить</Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
