import { z } from "zod";
import { apiError, callStructured, readAgentConfig } from "@/lib/model-client";
import { cellChangesSchema } from "@/lib/schemas";
import { isBriefRecognizedText, isEmptyCell } from "@/lib/table-utils";
import { normalizeBirthDate } from "@/lib/date-utils";
import type { CellChange } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  headers: z.array(z.string()).min(1).max(300),
  rows: z.array(z.object({ row: z.number().int().nonnegative(), values: z.array(z.unknown()) })).min(1).max(100),
  gaps: z.array(z.object({ row: z.number().int().nonnegative(), column: z.number().int().nonnegative() })).min(1).max(500),
  examples: z.array(z.array(z.unknown())).max(30),
  formats: z.record(z.string(), z.string()),
  categoricals: z.record(z.string(), z.array(z.string())).optional().default({}),
  instruction: z.string().max(3000).optional().default(""),
});

type FillBody = z.infer<typeof bodySchema>;
type Gap = FillBody["gaps"][number];

function cellKey(row: number, column: number) {
  return `${row}:${column}`;
}

function normalizedValue(value: string) {
  return value.toLocaleLowerCase("ru-RU").replaceAll("ё", "е").replace(/\s+/g, " ").trim();
}

function acceptedChanges(
  changes: CellChange[],
  gaps: Gap[],
  headers: string[],
  categoricals: Record<string, string[]>,
  birthDateFormat: string,
) {
  const allowed = new Set(gaps.map(({ row, column }) => cellKey(row, column)));
  const accepted = new Map<string, CellChange>();

  for (const change of changes) {
    const key = cellKey(change.row, change.column);
    if (!allowed.has(key)) continue;

    let value = String(change.value ?? "").trim();
    if (!value || value === "-") continue;

    const header = headers[change.column] ?? "";
    const allowedValues = categoricals[header];
    if (allowedValues?.length) {
      const canonical = allowedValues.find((candidate) => normalizedValue(candidate) === normalizedValue(value));
      if (!canonical) continue;
      value = canonical;
    }

    if (normalizedValue(header).includes("дата рождения")) {
      value = normalizeBirthDate(value, birthDateFormat);
    }

    accepted.set(key, { ...change, value });
  }

  return accepted;
}

function rowsWithChanges(rows: FillBody["rows"], changes: Iterable<CellChange>) {
  const next = rows.map(({ row, values }) => ({ row, values: [...values] }));
  const byRow = new Map(next.map((entry) => [entry.row, entry.values]));
  for (const change of changes) {
    const values = byRow.get(change.row);
    if (values && change.column < values.length) values[change.column] = change.value;
  }
  return next;
}

async function generateChanges(
  config: ReturnType<typeof readAgentConfig>,
  body: FillBody,
  rows: FillBody["rows"],
  gaps: Gap[],
  retry = false,
) {
  return callStructured({
    config,
    schema: cellChangesSchema,
    messages: [
      {
        role: "system",
        content: [
          "В rows переданы только строки, только что добавленные из распознавания.",
          ` Для каждой из ${gaps.length} ячеек в gaps верни изменение. Не пропускай пустые тематические колонки.`,
          " Не изменяй строки и ячейки, которых нет в gaps. Индексы row и column абсолютные и должны остаться без изменений.",
          " Если «Текст наказа» содержит одно-два общих слова, например «спорт», «ЖКХ», «дороги» или «благоустройство», разверни их в правдоподобный конкретный текст обращения в стиле examples.",
          " Колонки «Тематика предложения»/«Тематика обращения» и «Направление обращения» определяй по тексту наказа в той же строке. Для каждой такой колонки обязательно выбери ровно одно значение из соответствующего списка.",
          " Любую дату рождения возвращай строго в формате ДД.ММ.ГГГГ, например 18.09.2001.",
          " Верни только JSON вида {changes:[{row,column,value}]}. Пары row/column не должны повторяться.",
          retry ? " Это повторная попытка: в gaps оставлены только пропущенные или недопустимые ячейки. Заполни их все." : "",
          Object.keys(body.categoricals).length > 0
            ? `\nДопустимые значения категориальных колонок:\n${Object.entries(body.categoricals).map(([header, values]) => `- «${header}»: [${values.map((value) => `«${value}»`).join(", ")}]`).join("\n")}`
            : "",
          body.instruction.trim() ? `\nДополнительная инструкция пользователя:\n${body.instruction.trim()}` : "",
        ].join(""),
      },
      {
        role: "user",
        content: JSON.stringify({
          headers: body.headers,
          rows,
          gaps,
          examples: body.examples,
          formats: body.formats,
          categoricals: body.categoricals,
        }),
      },
    ],
  });
}

export async function POST(request: Request) {
  try {
    const config = readAgentConfig(request);
    const body = bodySchema.parse(await request.json());
    const rowsByIndex = new Map(body.rows.map(({ row, values }) => [row, values]));
    const safeGaps = body.gaps.filter(({ row, column }) => {
      const values = rowsByIndex.get(row);
      const current = values?.[column];
      const topicRefinement = column < body.headers.length && isBriefRecognizedText(current);
      return column < body.headers.length && values !== undefined && (isEmptyCell(current) || topicRefinement);
    });

    if (!safeGaps.length) {
      return Response.json({ error: "В выбранных новых строках нет доступных ячеек." }, { status: 400 });
    }

    const birthDateFormat = body.formats.birth_date ?? "DD.MM.YYYY";
    const first = await generateChanges(config, body, body.rows, safeGaps);
    const accepted = acceptedChanges(first.changes, safeGaps, body.headers, body.categoricals, birthDateFormat);
    let missing = safeGaps.filter(({ row, column }) => !accepted.has(cellKey(row, column)));

    if (missing.length) {
      const retryRows = rowsWithChanges(body.rows, accepted.values());
      const second = await generateChanges(config, body, retryRows, missing, true);
      const retryAccepted = acceptedChanges(second.changes, missing, body.headers, body.categoricals, birthDateFormat);
      for (const [key, change] of retryAccepted) accepted.set(key, change);
      missing = safeGaps.filter(({ row, column }) => !accepted.has(cellKey(row, column)));
    }

    const changes = safeGaps
      .map(({ row, column }) => accepted.get(cellKey(row, column)))
      .filter((change): change is CellChange => Boolean(change));

    if (!changes.length) {
      return Response.json({ error: "Модель не предложила допустимых значений. Повторите действие." }, { status: 502 });
    }

    return Response.json({ changes, missing: missing.length });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Не удалось подготовить пропуски." }, { status: 400 });
    }
    return apiError(error);
  }
}
