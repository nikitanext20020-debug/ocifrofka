import { z } from "zod";
import { apiError, callStructured, readAgentConfig } from "@/lib/model-client";
import { cellChangesSchema } from "@/lib/schemas";
import { isBriefRecognizedText, isEmptyCell } from "@/lib/table-utils";

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
    const allowed = new Set(safeGaps.map(({ row, column }) => `${row}:${column}`));
    const result = await callStructured({
      config,
      schema: cellChangesSchema,
      messages: [
        {
          role: "system",
          content: [
            "В rows переданы только строки, только что добавленные из распознавания. Заполни только перечисленные gaps правдоподобными значениями в стиле examples. Никогда не изменяй строки вне rows. Индексы row и column не меняй. Если поле уже содержит короткий распознанный текст по типу 'спорт', 'жкх', 'дороги', разрешено расширить его до полноценного текста наказа. Верни JSON {changes:[{row,column,value}]}.",
            Object.keys(body.categoricals).length > 0
              ? `\nКатегориальные колонки — обязательно выбирай только значения из списка:\n${Object.entries(body.categoricals).map(([header, values]) => `- «${header}»: [${values.map((v) => `«${v}»`).join(", ")}]`).join("\n")}`
              : "",
            body.instruction.trim() ? `\nИнструкция пользователя:\n${body.instruction.trim()}` : "",
          ].join(""),
        },
        { role: "user", content: JSON.stringify({ ...body, gaps: safeGaps }) },
      ],
    });
    return Response.json({ changes: result.changes.filter((change) => allowed.has(`${change.row}:${change.column}`)) });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Не удалось подготовить пропуски." }, { status: 400 });
    return apiError(error);
  }
}
