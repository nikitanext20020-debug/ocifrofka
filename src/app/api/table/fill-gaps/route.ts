import { z } from "zod";
import { apiError, callStructured, readAgentConfig } from "@/lib/model-client";
import { cellChangesSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  headers: z.array(z.string()).min(1).max(300),
  rows: z.array(z.object({ row: z.number().int().nonnegative(), values: z.array(z.unknown()) })).min(1).max(100),
  gaps: z.array(z.object({ row: z.number().int().nonnegative(), column: z.number().int().nonnegative() })).min(1).max(500),
  examples: z.array(z.array(z.unknown())).max(30),
  formats: z.record(z.string(), z.string()),
  categoricals: z.record(z.string(), z.array(z.string())).optional().default({}),
});

export async function POST(request: Request) {
  try {
    const config = readAgentConfig(request);
    const body = bodySchema.parse(await request.json());
    const allowed = new Set(body.gaps.map(({ row, column }) => `${row}:${column}`));
    const result = await callStructured({
      config,
      schema: cellChangesSchema,
      messages: [
        {
          role: "system",
          content: [
            "Заполни только перечисленные gaps правдоподобными синтетическими значениями в стиле examples и formats. Индексы row и column абсолютные, не меняй их. Верни JSON {changes:[{row,column,value}]}. Не возвращай таблицу целиком.",
            Object.keys(body.categoricals).length > 0
              ? `\nКатегориальные колонки — используй ТОЛЬКО указанные значения (выбери наиболее подходящее по смыслу, или «-» если ни одно не подходит):\n${Object.entries(body.categoricals).map(([header, values]) => `- «${header}»: [${values.map((v) => `«${v}»`).join(", ")}]`).join("\n")}`
              : "",
          ].join(""),
        },
        { role: "user", content: JSON.stringify(body) },
      ],
    });
    const changes = result.changes.filter((change) => allowed.has(`${change.row}:${change.column}`));
    return Response.json({ changes });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Не удалось подготовить пропуски для заполнения." }, { status: 400 });
    }
    return apiError(error);
  }
}
