"use client";

import { useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  ListChecks,
  PlusCircle,
  Redo2,
  Sparkles,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  applyCellChanges,
  applyFixedColumnValues,
  applyRecordCategories,
  findGapCells,
  findInsertRow,
  isEmptyCell,
  markSyntheticRowsForExport,
  mergeGeneratedRowsAt,
  mergeRecordsAt,
  normalizeTable,
  recordForApi,
} from "@/lib/table-utils";
import {
  FIELD_LABELS,
  NAME_PART_FIELDS,
  NAME_PART_LABELS,
  RECORD_FIELDS,
  type AppSettings,
  type CellChange,
  type CellMarks,
  type ColumnMapping,
  type ExtractedRecord,
  type InsertProgress,
  type MappableField,
  type MappingConflict,
  type NamePartField,
  type RecordField,
  type TableAnalysis,
  type TableSnapshot,
  type WorkbookData,
} from "@/lib/types";
import { clone, cn, readApiResponse } from "@/lib/utils";

import { loggedFetch, logAppError } from "@/lib/app-logs";
import { fetchWithFailover } from "@/lib/recognition-queue";
import { useLocalStorage } from "@/lib/use-local-storage";
import { sampleColumnValues } from "@/lib/column-mapping";
import { Button, Card, EmptyState, SectionTitle } from "@/components/ui";

const BATCH_SIZE = 30;
const PARALLEL_REQUESTS = 3;
const TABLE_PAGE_SIZE = 100;
const STANDARD_MAPPING_FIELDS = ["topic", "birth_date", "address", "phone"] as const;
const DEFAULT_GENERATION_INSTRUCTION = `Используй только направления: Благоустройство, Дороги, ЖКХ, Транспорт, Здравоохранение, Образование.
Тематики только: Обустройство самой большой страны в мире; Демографический вызов; Культурно-ценностный вызов.
Каждый текст состоит ровно из 2 коротких предложений. Порядок меняй: иногда сначала ситуация или последствие, иногда просьба, иногда люди, которых касается проблема. Тон спокойный, без наезда, канцелярита и длинных тире.
Не выдумывай новые направления. Темы должны быть крупными, но понятными: мост, поликлиника, школа, детский сад, парк, коммунальные сети, автобусы.
Пиши как обычные жители, а не как пресс-служба. Не начинай с «Нельзя», «Почему», «Лучше», «Нам бы», «Если можно», «В нашем», «У нас в», «Просим», «Очень просим», «Нужно» или «Необходимо». Не штампуй начала с «В» и названия населённого пункта. «Хотелось бы» и «Очень ждут» допустимы не более 1–2 раз во всей подборке.
Не начинай каждую строку с повелительного глагола. Чередуй конструкции: факт и решение; последствие и просьба; кто сталкивается с проблемой и что изменить; когда возникает проблема и какое улучшение поможет; просьба и конкретная причина. Не копируй соседний текст, меняя только улицу или город. Все обращения должны отличаться по началу, ритму и формулировкам.
В колонке вовлечённости в деятельность Партии выбери «Иное». Остальные значения выбирай по смыслу.`;

function progressFromFileName(fileName: string): InsertProgress | null {
  const match = fileName.match(/-строки-(\d+)-(\d+)(?:\.[^.]+)?$/i);
  if (!match) return null;
  const startRow = Number(match[1]);
  const endRow = Number(match[2]);
  if (!Number.isInteger(startRow) || !Number.isInteger(endRow) || endRow < startRow) return null;
  return { startRow, endRow, count: endRow - startRow + 1 };
}

function normalizedHeader(value: string) {
  return value.toLocaleLowerCase("ru-RU").replaceAll("ё", "е").replace(/[^a-zа-я0-9]+/gi, " ").trim();
}

function isDerivedCategoryHeader(value: string) {
  const header = normalizedHeader(value);
  return header.startsWith("тематика предложения") || header.startsWith("тематика обращения") || header.startsWith("направление обращения");
}

function isGeneratorCategoricalHeader(value: string) {
  const header = normalizedHeader(value);
  return isDerivedCategoryHeader(value)
    || header === "муниципалитет"
    || header.startsWith("вовлеченность в деятельность партии");
}

function isGeneratedColumnHeader(value: string) {
  return /^колонка \d+$/.test(normalizedHeader(value));
}

function isNamePartField(field: MappableField): field is NamePartField {
  return (NAME_PART_FIELDS as readonly string[]).includes(field);
}

function isStructuredModelFormatError(error: unknown) {
  return error instanceof Error && /^Модель (?:дважды|трижды) вернула неверный формат/.test(error.message);
}

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

type BusyAction = "load" | "analyze" | "insert" | "gaps" | "generate" | null;

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
  const tableViewportRef = useRef<HTMLDivElement>(null);
  const [workbook, setWorkbook] = useState<WorkbookData | null>(null);
  const [analysis, setAnalysis] = useState<TableAnalysis | null>(null);
  const [insertRow, setInsertRow] = useState<number | null>(null);
  const [marks, setMarks] = useState<CellMarks>({});
  const [newRows, setNewRows] = useState<number[]>([]);
  const [syntheticRows, setSyntheticRows] = useState<number[]>([]);
  const [categoricalDefaults, setCategoricalDefaults] = useState<Record<number, string>>({});
  const [insertProgress, setInsertProgress] = useState<InsertProgress | null>(null);
  const [history, setHistory] = useState<TableSnapshot[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [instruction, setInstruction] = useLocalStorage("digitizer-fill-gaps-instruction", "");
  const [generationInstruction, setGenerationInstruction] = useLocalStorage("digitizer-generation-instruction", DEFAULT_GENERATION_INSTRUCTION);
  const [generationCount, setGenerationCount] = useState(10);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [tablePage, setTablePage] = useState(0);

  const table = workbook ? workbook.sheets[workbook.activeSheet] : null;
  const tablePageCount = Math.max(1, Math.ceil((table?.rows.length ?? 0) / TABLE_PAGE_SIZE));
  const activeTablePage = Math.min(tablePage, tablePageCount - 1);
  const visibleRowStart = activeTablePage * TABLE_PAGE_SIZE;
  const visibleRowEnd = Math.min(visibleRowStart + TABLE_PAGE_SIZE, table?.rows.length ?? 0);
  const visibleRows = useMemo(
    () => table?.rows.slice(visibleRowStart, visibleRowEnd) ?? [],
    [table?.rows, visibleRowEnd, visibleRowStart],
  );
  const hasNameMapping = analysis
    ? analysis.mapping.full_name !== null || NAME_PART_FIELDS.some((field) => analysis.mapping[field] !== null)
    : false;
  const mappedCount = analysis
    ? STANDARD_MAPPING_FIELDS.filter((field) => analysis.mapping[field] !== null).length + (hasNameMapping ? 1 : 0)
    : 0;

  const updateColumnMapping = (field: MappableField, rawValue: string) => {
    const column = rawValue === "" ? null : Number(rawValue);
    setAnalysis((current) => {
      if (!current) return current;
      const mapping = { ...current.mapping, [field]: column };

      if (field === "full_name" && column !== null) {
        for (const part of NAME_PART_FIELDS) mapping[part] = null;
      } else if (isNamePartField(field) && column !== null) {
        mapping.full_name = null;
        for (const part of NAME_PART_FIELDS) {
          if (part !== field && mapping[part] === column) mapping[part] = null;
        }
      }

      return { ...current, mapping };
    });
  };

  const showTablePage = (page: number) => {
    setTablePage(Math.max(0, Math.min(tablePageCount - 1, page)));
    requestAnimationFrame(() => tableViewportRef.current?.scrollTo({ top: 0 }));
  };

  const pushSnapshot = () => {
    if (!workbook) return;
    setHistory((current) => [
      ...current.slice(-9),
      {
        workbook: clone(workbook),
        marks: clone(marks),
        newRows: [...newRows],
        syntheticRows: [...syntheticRows],
        categoricalDefaults: { ...categoricalDefaults },
        notice,
        insertProgress,
      },
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
          const ws = parsed.Sheets[name];
          const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
            header: 1,
            raw: false,
            defval: "",
          });
          // Pass merge ranges so merged header cells are expanded correctly.
          return [name, normalizeTable(matrix, (ws as Record<string, unknown>)["!merges"] as Parameters<typeof normalizeTable>[1])];
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
      setSyntheticRows([]);
      setCategoricalDefaults({});
      setInsertProgress(progressFromFileName(file.name));
      setHistory([]);
      setNotice(null);
      setTablePage(0);
      toast.success("Таблица загружена");
    } catch (error) {
      logAppError("Excel", error, { action: "Загрузка таблицы" });
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
      const sourceSheet = workbook.sheets[sheetName];
      const sheet = sheetName === workbook.activeSheet
        ? markSyntheticRowsForExport(sourceSheet, syntheticRows)
        : sourceSheet;
      const ws = XLSX.utils.aoa_to_sheet([sheet.headers, ...sheet.rows]);
      if (sheetName === workbook.activeSheet && analysis && analysis.mapping.phone !== null) {
        const phoneCol = analysis.mapping.phone;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const utils = XLSX.utils as any;
        for (let r = 1; r <= sheet.rows.length; r++) {
          const cellRef = utils.encode_cell({ r, c: phoneCol });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cell = ws[cellRef] as any;
          if (cell) {
            cell.t = "s";
            cell.z = "@";
            const val = cell.v;
            if (val !== undefined && val !== null) {
              cell.v = String(val);
            }
          }
        }
      }
      XLSX.utils.book_append_sheet(
        output,
        ws,
        sheetName,
      );
    }
    const baseName = workbook.fileName.replace(/\.(xlsx|xls|csv)$/i, "");
    const progressSuffix = insertProgress
      ? `-строки-${insertProgress.startRow}-${insertProgress.endRow}`
      : "";
    XLSX.writeFile(output, `${baseName}-обработано${progressSuffix}.xlsx`);
  };

  const analyze = async () => {
    if (!table || !table.headers.length) return;
    setBusy("analyze");
    try {
      const rows = table.rows
        .filter((row) => row.some((cell) => String(cell ?? "").trim()))
        .slice(0, 20);
      const response = await fetchWithFailover({
        agents: settings.tableAgents,
        activeAgentId: settings.activeTableAgentId,
        timeoutSeconds: settings.agentTimeout ?? 60,
        path: "/api/table/analyze",
        method: "POST",
        body: JSON.stringify({ headers: table.headers, rows }),
        area: "Excel",
        action: "Анализ структуры таблицы",
        fetcher: (input, init) => loggedFetch(input, init, {
          area: "Excel",
          action: "Анализ структуры таблицы",
          details: { columnCount: table.headers.length, sampleCount: rows.length },
        }),
      });
      const result = await readApiResponse<{ mapping: ColumnMapping; formats: Record<RecordField, string>; conflicts?: MappingConflict[] }>(response);
      // Compute categoricals client-side from ALL rows (no model needed)
      const categoricals: Record<number, string[]> = {};
      table.headers.forEach((header, colIndex) => {
        if (isGeneratedColumnHeader(header)) return;
        const valueSet = new Set<string>();
        for (const row of table.rows) {
          const val = String(row[colIndex] ?? "").trim();
          if (!isEmptyCell(val)) valueSet.add(val);
        }
        if (valueSet.size <= 30 && (valueSet.size >= 2 || (valueSet.size === 1 && isGeneratorCategoricalHeader(header)))) {
          categoricals[colIndex] = [...valueSet].sort();
        }
      });
      const fullResult: TableAnalysis = { ...result, categoricals, conflicts: result.conflicts };
      setAnalysis(fullResult);
      const suggestedDefaults: Record<number, string> = {};
      for (const [rawColumn, values] of Object.entries(categoricals)) {
        const column = Number(rawColumn);
        const header = normalizedHeader(table.headers[column] ?? "");
        const bogorodsky = values.find((value) => value.toLocaleLowerCase("ru-RU") === "богородский г.о.");
        const other = values.find((value) => value.toLocaleLowerCase("ru-RU") === "иное");
        if (header === "муниципалитет" && bogorodsky) suggestedDefaults[column] = bogorodsky;
        else if (header.startsWith("вовлеченность в деятельность партии") && other) suggestedDefaults[column] = other;
      }
      setCategoricalDefaults(suggestedDefaults);
      setInsertRow(findInsertRow(table, result.mapping));
      toast.success("Структура таблицы определена");
    } catch (error) {
      logAppError("Excel", error, { action: "Анализ структуры таблицы", columnCount: table.headers.length });
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
        if (field === "topic") continue;
        const col = analysis.mapping[field];
        if (col !== null && analysis.categoricals[col]) {
          fieldCategoricals[field] = analysis.categoricals[col];
        }
      }
      const categoryColumns = Object.entries(analysis.categoricals)
        .map(([rawColumn, values]) => ({ column: Number(rawColumn), header: table.headers[Number(rawColumn)] ?? "", values }))
        .filter(({ header }) => isDerivedCategoryHeader(header));

      const normalized: Array<Record<(typeof RECORD_FIELDS)[number], string> & { categories: Record<string, string> }> = [];
      let usedRawFallback = false;
      for (let start = 0; start < queue.length; start += BATCH_SIZE) {
        const batch = queue.slice(start, start + BATCH_SIZE).map(recordForApi);
        try {
          const response = await fetchWithFailover({
            agents: settings.tableAgents,
            activeAgentId: settings.activeTableAgentId,
            timeoutSeconds: settings.agentTimeout ?? 60,
            path: "/api/table/insert",
            method: "POST",
            body: JSON.stringify({ records: batch, formats: analysis.formats, categoricals: fieldCategoricals, categoryColumns }),
            area: "Excel",
            action: "Подготовка распознанных записей",
            fetcher: (input, init) => loggedFetch(input, init, {
              area: "Excel",
              action: "Подготовка распознанных записей",
              details: { requestedCount: batch.length },
            }),
          });
          const result = await readApiResponse<{ records: typeof normalized }>(response);
          normalized.push(...result.records);
        } catch (error) {
          if (!isStructuredModelFormatError(error)) throw error;
          usedRawFallback = true;
          normalized.push(...batch.map((record) => ({ ...record, categories: {} })));
        }
      }
      if (usedRawFallback) {
        toast.warning("Модель вернула неверный формат, поэтому часть данных вставлена в исходном виде без дополнительного форматирования.");
      }

      const startIndex = insertRow ?? findInsertRow(table, analysis.mapping);
      pushSnapshot();
      const { rows: mergedRows, writtenRows } = mergeRecordsAt(table, normalized, analysis.mapping, startIndex);
      const categorized = applyRecordCategories(mergedRows, writtenRows, normalized);
      const fixed = applyFixedColumnValues(categorized.rows, writtenRows, categoricalDefaults);
      replaceActiveRows(fixed.rows);
      setNewRows(writtenRows);
      setInsertRow(startIndex + writtenRows.length);
      setMarks({});

      if (writtenRows.length > 0) {
        showTablePage(Math.floor(writtenRows[0] / TABLE_PAGE_SIZE));
        const startExcel = writtenRows[0] + 2;
        const endExcel = writtenRows[writtenRows.length - 1] + 2;
        setInsertProgress({ startRow: startExcel, endRow: endExcel, count: writtenRows.length });
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
      logAppError("Excel", error, { action: "Вставка распознанных записей", requestedCount: queue.length });
      toast.error(error instanceof Error ? error.message : "Не удалось вставить записи");
    } finally {
      setBusy(null);
    }
  };

  const fillGaps = async () => {
    if (!table || !analysis) return;
    if (!newRows.length) {
      toast.info("Сначала занесите новые строки из распознавания");
      return;
    }
    const fixed = applyFixedColumnValues(table.rows, newRows, categoricalDefaults);
    const workingTable = { ...table, rows: fixed.rows };
    const gaps = findGapCells(workingTable, analysis.mapping, newRows);
    if (!gaps.length) {
      if (fixed.applied.length) {
        pushSnapshot();
        replaceActiveRows(fixed.rows);
        setNotice(`В новых строках применено фиксированных значений: ${fixed.applied.length}`);
        toast.success(`Заполнено фиксированных значений: ${fixed.applied.length}`);
      } else {
        toast.info("В новых строках нет пропусков в замаппированных колонках");
      }
      return;
    }

    const fixablePhones = gaps.filter((g) => g.phoneStatus === "fixable");
    const invalidPhones = gaps.filter((g) => g.phoneStatus === "invalid");
    const modelGaps = gaps.filter((g) => !g.phoneStatus);

    const phoneFixChanges: CellChange[] = fixablePhones.map((g) => ({
      row: g.row,
      column: g.column,
      value: g.phoneFormatted || "",
    }));

    if (!modelGaps.length) {
      const finalGapsSet = new Set(fixablePhones.map(({ row, column }) => `${row}:${column}`));
      const applied = applyCellChanges(workingTable.rows, phoneFixChanges, finalGapsSet);
      pushSnapshot();
      replaceActiveRows(applied.rows);

      const nextMarks = { ...marks };
      applied.applied.forEach((change) => {
        nextMarks[`${change.row}:${change.column}`] = "generated";
      });
      invalidPhones.forEach((g) => {
        nextMarks[`${g.row}:${g.column}`] = "phone-invalid";
      });
      setMarks(nextMarks);

      const msg = `Исправлено форматирование: ${fixablePhones.length} номеров, требуют проверки: ${invalidPhones.length}`;
      setNotice(msg);
      toast.success(msg);
      return;
    }

    setBusy("gaps");
    try {
      // Build column-header-level categoricals for fill-gaps prompt
      const columnCategoricals: Record<string, string[]> = {};
      for (const [colIdx, values] of Object.entries(analysis.categoricals)) {
        const headerName = table.headers[Number(colIdx)];
        if (headerName && isDerivedCategoryHeader(headerName)) columnCategoricals[headerName] = values;
      }
      const examples = workingTable.rows
        .filter((row) => Object.values(analysis.mapping).every((column) => column === null || String(row[column] ?? "").trim()))
        .slice(0, 10);
      const groupedRows = [...new Set(modelGaps.map(({ row }) => row))];
      const tasks: Array<() => Promise<CellChange[]>> = [];
      const batchWarnings: string[] = [];
      for (let start = 0; start < groupedRows.length; start += BATCH_SIZE) {
        const rowIndexes = groupedRows.slice(start, start + BATCH_SIZE);
        const rowSet = new Set(rowIndexes);
        const batchGaps = modelGaps.filter(({ row }) => rowSet.has(row));
        tasks.push(async () => {
          const response = await fetchWithFailover({
            agents: settings.tableAgents,
            activeAgentId: settings.activeTableAgentId,
            timeoutSeconds: settings.agentTimeout ?? 60,
            path: "/api/table/fill-gaps",
            method: "POST",
            body: JSON.stringify({
              headers: table.headers,
              rows: rowIndexes.map((row) => ({ row, values: workingTable.rows[row] })),
              gaps: batchGaps,
              examples,
              formats: analysis.formats,
              categoricals: columnCategoricals,
              instruction: instruction.trim(),
            }),
            area: "Excel",
            action: "Заполнение пропусков",
            fetcher: (input, init) => loggedFetch(input, init, {
              area: "Excel",
              action: "Заполнение пропусков",
              details: { requestedCount: batchGaps.length },
            }),
          });
          const result = await readApiResponse<{ changes: CellChange[]; missing?: number; warning?: string }>(response);
          if (result.warning) batchWarnings.push(result.warning);
          else if (result.missing) batchWarnings.push(`Не заполнено ячеек: ${result.missing}.`);
          return result.changes;
        });
      }
      const { results: changes, errors } = await runBatches(tasks);
      const allChanges = [...changes, ...phoneFixChanges];
      const allowed = new Set([
        ...modelGaps.map(({ row, column }) => `${row}:${column}`),
        ...fixablePhones.map(({ row, column }) => `${row}:${column}`),
      ]);
      const applied = applyCellChanges(workingTable.rows, allChanges, allowed);
      if (!applied.applied.length && !fixed.applied.length && !phoneFixChanges.length) {
        throw errors[0] ?? new Error("Модель не предложила значений для пропусков");
      }
      if (errors.length) {
        toast.warning(`Часть батчей не обработана (${errors.length}). Нажмите «Дополнить пропуски» ещё раз для оставшихся ячеек.`);
      }
      if (batchWarnings.length) toast.warning([...new Set(batchWarnings)].join(" "));
      pushSnapshot();
      replaceActiveRows(applied.rows);

      const nextMarks = { ...marks };
      applied.applied.forEach(({ row, column }) => {
        nextMarks[`${row}:${column}`] = "generated";
      });
      invalidPhones.forEach((g) => {
        nextMarks[`${g.row}:${g.column}`] = "phone-invalid";
      });
      setMarks(nextMarks);

      const modelApplied = applied.applied.filter(
        (ch) => !phoneFixChanges.some((p) => p.row === ch.row && p.column === ch.column),
      );
      setSyntheticRows((current) => [...new Set([...current, ...modelApplied.map(({ row }) => row)])]);

      const fixCount = fixablePhones.length;
      const invalidCount = invalidPhones.length;
      const modelCount = modelApplied.length;

      const noticeMsg = `В новых строках сгенерировано значений: ${modelCount}. Исправлено форматирование: ${fixCount} номеров, требуют проверки: ${invalidCount}.`;
      setNotice(noticeMsg);
      toast.success(`Заполнено ячеек: ${applied.applied.length}`);
    } catch (error) {
      logAppError("Excel", error, { action: "Заполнение пропусков", requestedCount: gaps.length });
      toast.error(error instanceof Error ? error.message : "Не удалось заполнить пропуски");
    } finally {
      setBusy(null);
    }
  };

  const generateSyntheticRows = async () => {
    if (!table || !analysis) return;
    const count = Number.isFinite(generationCount)
      ? Math.max(1, Math.min(100, Math.round(generationCount)))
      : 1;
    setBusy("generate");
    try {
      const examples = table.rows
        .filter((row, rowIndex) => (
          !syntheticRows.includes(rowIndex)
          && row.filter((value) => String(value ?? "").trim()).length >= Math.min(3, table.headers.length)
        ))
        .slice(0, 20);
      const categoricals = Object.fromEntries(
        Object.entries(analysis.categoricals)
          .filter(([rawColumn]) => isGeneratorCategoricalHeader(table.headers[Number(rawColumn)] ?? ""))
          .map(([rawColumn, values]) => [table.headers[Number(rawColumn)], values] as const)
          .filter(([header]) => Boolean(header)),
      );
      const fixedValues = Object.fromEntries(
        Object.entries(categoricalDefaults)
          .map(([rawColumn, value]) => [table.headers[Number(rawColumn)], value] as const)
          .filter(([header, value]) => Boolean(header && value)),
      );
      const startIndex = insertRow ?? findInsertRow(table, analysis.mapping);
      const topicCol = analysis.mapping.topic;
      const forbiddenTexts = topicCol !== null
        ? table.rows.slice(-200).map((row) => String(row[topicCol] ?? "").trim()).filter(Boolean)
        : [];
      const response = await fetchWithFailover({
        agents: settings.tableAgents,
        activeAgentId: settings.activeTableAgentId,
        timeoutSeconds: settings.agentTimeout ?? 60,
        path: "/api/table/generate",
        method: "POST",
        body: JSON.stringify({
          count,
          headers: table.headers,
          examples,
          formats: analysis.formats,
          categoricals,
          fixedValues,
          instruction: generationInstruction.trim(),
          sequenceStart: startIndex,
          forbiddenTexts,
        }),
        area: "Генератор",
        action: "Создание синтетических строк",
        fetcher: (input, init) => loggedFetch(input, init, {
          area: "Генератор",
          action: "Создание синтетических строк",
          details: { requestedCount: count, columnCount: table.headers.length },
        }),
      });
      const result = await readApiResponse<{ rows: string[][]; warning?: string }>(response);

      const merged = mergeGeneratedRowsAt(table, result.rows, startIndex);
      if (!merged.applied.length) {
        throw new Error("Модель вернула строки, но ни одно значение не попало в свободные ячейки. Проверьте строку начала вставки.");
      }
      const fixed = applyFixedColumnValues(merged.rows, merged.writtenRows, categoricalDefaults);
      const allApplied = [...merged.applied, ...fixed.applied];
      pushSnapshot();
      replaceActiveRows(fixed.rows);
      setNewRows(merged.writtenRows);
      setSyntheticRows((current) => [...new Set([...current, ...merged.writtenRows])]);
      setMarks(Object.fromEntries(allApplied.map(({ row, column }) => [`${row}:${column}`, "generated"] as const)));
      setInsertRow(Math.max(...merged.writtenRows) + 1);
      if (merged.writtenRows.length) showTablePage(Math.floor(merged.writtenRows[0] / TABLE_PAGE_SIZE));
      setNotice(`Создано синтетических тестовых строк: ${merged.writtenRows.length}. При скачивании они будут явно помечены.`);
      toast.success(`Создано тестовых строк: ${merged.writtenRows.length}`);
      if (result.warning) toast.warning(result.warning);
    } catch (error) {
      logAppError("Генератор", error, { action: "Создание синтетических строк", requestedCount: count });
      toast.error(error instanceof Error ? error.message : "Не удалось создать тестовые строки");
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
    setSyntheticRows(snapshot.syntheticRows);
    setCategoricalDefaults(snapshot.categoricalDefaults);
    setInsertProgress(snapshot.insertProgress);
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
                      setAnalysis(null); setInsertRow(null); setMarks({}); setNewRows([]); setSyntheticRows([]); setCategoricalDefaults({}); setInsertProgress(null); setHistory([]); setNotice(null);
                      setTablePage(0);
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
              <div ref={tableViewportRef} className="max-h-[560px] overflow-auto">
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
                    {visibleRows.map((row, visibleIndex) => {
                      const rowIndex = visibleRowStart + visibleIndex;
                      return (
                      <tr className={cn("border-b border-[#e5ebe8]", newRows.includes(rowIndex) && "bg-[#e8f7ee]")} key={rowIndex}>
                        <td className="border-r border-[#e0e7e4] px-3 py-2 text-center text-xs text-[#7b8985]">{rowIndex + 2}</td>
                         {table.headers.map((_, columnIndex) => {
                          const mark = marks[`${rowIndex}:${columnIndex}`];
                          const digitsCount = (String(row[columnIndex] ?? "").replace(/\D/g, "")).length;
                          return (
                            <td
                              className={cn(
                                "max-w-80 border-r border-[#e0e7e4] px-3 py-2 align-top text-[#293733]",
                                mark === "generated" && "bg-[#fff0d5]",
                                mark === "custom" && "bg-[#e8f1ff]",
                                mark === "phone-invalid" && "bg-[#ffebe0]",
                              )}
                              title={mark === "phone-invalid" ? `Номер неполный: ${digitsCount} цифр, требуется проверка по исходному фото` : undefined}
                              key={columnIndex}
                            >
                              <div className="break-words">{String(row[columnIndex] ?? "") || <span className="text-[#a3ada9]">пусто</span>}</div>
                              {mark === "generated" && <span className="mt-1 inline-flex text-[10px] font-semibold uppercase text-[#97651d]">сгенерировано</span>}
                              {mark === "custom" && <span className="mt-1 inline-flex text-[10px] font-semibold uppercase text-[#37689a]">изменено</span>}
                              {mark === "phone-invalid" && <span className="mt-1 inline-flex text-[10px] font-semibold uppercase text-orange-700">требует проверки</span>}
                            </td>
                          );
                        })}
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e0e8e5] px-4 py-3 text-sm text-[#61706b]">
              <span>
                Показано {table.rows.length ? visibleRowStart + 1 : 0}–{visibleRowEnd} из {table.rows.length} строк
              </span>
              {tablePageCount > 1 && (
                <div className="flex items-center gap-2">
                  <Button variant="secondary" className="h-9 px-2.5" disabled={activeTablePage === 0} onClick={() => showTablePage(activeTablePage - 1)} title="Предыдущая страница">
                    <ChevronLeft className="size-4" />
                  </Button>
                  <label className="flex items-center gap-1.5">
                    Страница
                    <input
                      type="number"
                      min={1}
                      max={tablePageCount}
                      className="h-9 w-20 rounded-md border border-[#cbd6d2] bg-white px-2 text-center text-sm outline-none focus:border-[#23816e]"
                      value={activeTablePage + 1}
                      onChange={(event) => showTablePage(Number(event.target.value) - 1)}
                    />
                    из {tablePageCount}
                  </label>
                  <Button variant="secondary" className="h-9 px-2.5" disabled={activeTablePage >= tablePageCount - 1} onClick={() => showTablePage(activeTablePage + 1)} title="Следующая страница">
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              )}
            </div>
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
                <Button variant="secondary" loading={busy === "gaps"} disabled={!analysis || !newRows.length} onClick={fillGaps}><Sparkles className="size-4" /> {instruction.trim() ? "Дополнить пропуски по инструкции" : "Дополнить пропуски в новых строках"}</Button>
              </div>
              {!analysis && <p className="mt-3 text-sm text-[#806b32]">Сначала проанализируйте таблицу, чтобы определить колонки и форматы.</p>}
              {notice && <div className="mt-4 rounded-md border border-[#b9dfd3] bg-[#edf8f4] px-4 py-3 text-sm font-medium text-[#1e6958]">{notice}</div>}
              {insertProgress && (
                <div className="mt-3 rounded-md border border-[#c8d9ef] bg-[#f1f6fd] px-4 py-3 text-sm text-[#31567e]">
                  <strong>Последняя партия:</strong> строки {insertProgress.startRow}–{insertProgress.endRow} ({insertProgress.count} записей).
                  <span className="ml-1">Следующую партию начинайте со строки {insertProgress.endRow + 1}.</span>
                </div>
              )}
            </Card>
          )}

          {analysis && (
            <Card className="p-5">
              <SectionTitle title={`Маппинг колонок · ${mappedCount} из 5`} description="Проверьте соответствие и при необходимости выберите колонки вручную." />
              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {STANDARD_MAPPING_FIELDS.map((field) => {
                  const conflict = analysis.conflicts?.find(
                    (c: MappingConflict) => c.field === field,
                  );
                  const selectedCol = analysis.mapping[field];
                  const samples = selectedCol !== null && selectedCol !== undefined && table
                    ? sampleColumnValues(table.rows, selectedCol, 3)
                    : [];
                  return (
                    <label key={field}>
                      <span className="mb-1.5 block text-sm font-medium">{FIELD_LABELS[field]}</span>
                      <select
                        className="h-10 w-full rounded-md border border-[#cbd6d2] bg-white px-3 text-sm"
                        value={analysis.mapping[field] ?? ""}
                        onChange={(event) => updateColumnMapping(field, event.target.value)}
                      >
                        <option value="">Не определено</option>
                        {columnOptions.map(({ index, label }) => <option value={index} key={index}>{label}</option>)}
                      </select>
                      {conflict && (
                        <p className="mt-1 flex items-start gap-1 text-xs leading-5 text-amber-700">
                          <span>⚠️</span>
                          <span>Заголовок указывал на другую колонку — данные не совпали, выбрана колонка с подходящим содержимым.</span>
                        </p>
                      )}
                      {samples.length > 0 && (
                        <p className="mt-1 text-xs leading-5 text-[#71807b]">
                          {analysis.formats[field] || "Формат не определён"}{" "}
                          <span className="font-medium text-[#4a6b65]">
                            {samples.slice(0, 3).map((s, i) => (
                              <span key={i}>{i > 0 ? " · " : ""}{s}</span>
                            ))}
                          </span>
                        </p>
                      )}
                      {samples.length === 0 && (
                        <p className="mt-1 text-xs leading-5 text-[#71807b]">{analysis.formats[field] || "Формат не определён"}</p>
                      )}
                    </label>
                  );
                })}
              </div>
              <div className="mt-5 rounded-md border border-[#d9e4e0] bg-[#f7faf8] p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-[#33423e]">ФИО</p>
                    <p className="mt-1 text-xs leading-5 text-[#71807b]">
                      Выберите либо одну колонку с полным ФИО, либо отдельные колонки фамилии, имени и отчества.
                    </p>
                  </div>
                  <span className="rounded-full bg-[#e0f0ea] px-2.5 py-1 text-xs font-medium text-[#1e6958]">
                    {analysis.mapping.full_name !== null
                      ? "ФИО в одной колонке"
                      : hasNameMapping
                        ? "ФИО в отдельных колонках"
                        : "Не определено"}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <label>
                    <span className="mb-1.5 block text-sm font-medium">ФИО одной строкой</span>
                    <select
                      className="h-10 w-full rounded-md border border-[#cbd6d2] bg-white px-3 text-sm"
                      value={analysis.mapping.full_name ?? ""}
                      onChange={(event) => updateColumnMapping("full_name", event.target.value)}
                    >
                      <option value="">Не используется</option>
                      {columnOptions.map(({ index, label }) => <option value={index} key={index}>{label}</option>)}
                    </select>
                  </label>
                  {NAME_PART_FIELDS.map((field) => (
                    <label key={field}>
                      <span className="mb-1.5 block text-sm font-medium">{NAME_PART_LABELS[field]}</span>
                      <select
                        className="h-10 w-full rounded-md border border-[#cbd6d2] bg-white px-3 text-sm"
                        value={analysis.mapping[field] ?? ""}
                        onChange={(event) => updateColumnMapping(field, event.target.value)}
                      >
                        <option value="">Не определено</option>
                        {columnOptions.map(({ index, label }) => <option value={index} key={index}>{label}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-[#71807b]">
                  {analysis.formats.full_name || "Формат ФИО не определён"}
                </p>
              </div>
              {Object.keys(analysis.categoricals).length > 0 && (
                <div className="mt-5 border-t border-[#e0e8e5] pt-5">
                  <p className="mb-3 text-sm font-semibold text-[#33423e]">Категориальные колонки <span className="ml-1 font-normal text-[#71807b]">(можно закрепить одно значение для всех новых строк)</span></p>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {Object.entries(analysis.categoricals).map(([colIdx, values]) => {
                      const column = Number(colIdx);
                      return (
                      <div key={colIdx} className="rounded-md border border-[#d9e4e0] bg-[#f7faf8] p-3">
                        <p className="mb-2 text-xs font-semibold text-[#3a5450]">{table.headers[column] ?? `Колонка ${column + 1}`}</p>
                        <label className="mb-3 block">
                          <span className="mb-1 block text-[11px] text-[#71807b]">Значение для всех новых строк</span>
                          <select
                            className="h-9 w-full rounded-md border border-[#cbd6d2] bg-white px-2 text-xs"
                            value={categoricalDefaults[column] ?? ""}
                            onChange={(event) => setCategoricalDefaults((current) => ({ ...current, [column]: event.target.value }))}
                          >
                            <option value="">Модель выбирает по смыслу</option>
                            {values.map((value) => <option value={value} key={value}>{value}</option>)}
                          </select>
                        </label>
                        <div className="flex flex-wrap gap-1">
                          {values.map((v) => (
                            <span key={v} className="rounded-full bg-[#e0f0ea] px-2 py-0.5 text-xs text-[#1e6958]">{v}</span>
                          ))}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card>
          )}

          <Card className="p-5">
            <SectionTitle
              title="Генератор синтетических тестовых строк"
              description="Создаёт новые строки по формату и стилю примеров. Они не должны использоваться как записи реальных людей и при скачивании помечаются как синтетические."
            />
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="w-40">
                <span className="mb-1.5 block text-sm font-medium">Количество строк</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="h-10 w-full rounded-md border border-[#cbd6d2] bg-white px-3 text-sm outline-none focus:border-[#23816e] focus:ring-2 focus:ring-[#23816e]/15"
                  value={generationCount}
                  onChange={(event) => setGenerationCount(Number(event.target.value))}
                  disabled={!analysis}
                />
              </label>
              <Button
                loading={busy === "generate"}
                disabled={!analysis || busy !== null}
                onClick={generateSyntheticRows}
              >
                <Sparkles className="size-4" /> Создать тестовые строки
              </Button>
            </div>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-sm font-medium">Дополнительный промпт</span>
              <textarea
                className="min-h-48 w-full resize-y rounded-md border border-[#cbd6d2] p-3 text-sm outline-none focus:border-[#23816e] focus:ring-2 focus:ring-[#23816e]/15"
                value={generationInstruction}
                onChange={(event) => setGenerationInstruction(event.target.value)}
                disabled={!analysis}
              />
            </label>
            {!analysis && <p className="mt-3 text-sm text-[#806b32]">Сначала проанализируйте таблицу, чтобы определить форматы и допустимые значения.</p>}
          </Card>

          <Card className="p-5">
            <SectionTitle title="Инструкция для заполнения пропусков" description="Используется только кнопкой «Дополнить пропуски» и только для последних добавленных строк. Заполненные и старые ячейки не изменяются." />
            <textarea
              className="mt-4 min-h-24 w-full resize-y rounded-md border border-[#cbd6d2] p-3 text-sm outline-none focus:border-[#23816e] focus:ring-2 focus:ring-[#23816e]/15"
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="Например: заполни отсутствующие поля правдоподобными синтетическими значениями в формате таблицы"
              disabled={!analysis}
            />
            <p className="mt-2 text-xs leading-5 text-[#806b32]">Строки, в которых модель создаст значения, при скачивании получат статус «Синтетические данные».</p>
          </Card>
        </>
      )}
    </div>
  );
}
