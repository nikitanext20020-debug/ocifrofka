import { z } from "zod";
import { apiError, callStructured, readAgentConfig } from "@/lib/model-client";
import { cellChangesSchema } from "@/lib/schemas";

export const runtime = "nodejs";

const bodySchema = z.object({
  instruction: z.string().min(3).max(3000),
  headers: z.array(z.string()).min(1).max(300),
  rows: z.array(z.object({ row: z.number().int().nonnegative(), values: z.array(z.unknown()) })).max(100),
});

export async function POST(request: Request) {
  try {
    const config = readAgentConfig(request);
    const body = bodySchema.parse(await request.json());
    const rowIndexes = new Set(body.rows.map(({ row }) => row));
    const result = await callStructured({
      config,
      schema: cellChangesSchema,
      messages: [
        {
          role: "system",
          content: "Выполни инструкцию над переданным фрагментом таблицы. Верни только реально нужные изменения JSON {changes:[{row,column,value}]}. row — абсолютный индекс строки данных с нуля, column — индекс заголовка с нуля. Не возвращай неизменённые ячейки и таблицу целиком.",
        },
        { role: "user", content: JSON.stringify(body) },
      ],
    });
    const changes = result.changes.filter(
      (change) => rowIndexes.has(change.row) && change.column < body.headers.length,
    );
    return Response.json({ changes });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Проверьте текст инструкции и данные таблицы." }, { status: 400 });
    }
    return apiError(error);
  }
}
