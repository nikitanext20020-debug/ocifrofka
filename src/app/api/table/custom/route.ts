import { z } from "zod";
import { apiError, callStructured, readAgentConfig } from "@/lib/model-client";
import { cellChangesSchema, columnMappingSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  instruction: z.string().min(3).max(3000),
  headers: z.array(z.string()).min(1).max(300),
  rows: z.array(z.object({ row: z.number().int().nonnegative(), values: z.array(z.unknown()) })).max(100),
  mapping: columnMappingSchema,
});

export async function POST(request: Request) {
  try {
    const config = readAgentConfig(request, "table");
    const body = bodySchema.parse(await request.json());
    const rowIndexes = new Set(body.rows.map(({ row }) => row));
    const result = await callStructured({
      config,
      schema: cellChangesSchema,
      messages: [
        {
          role: "system",
          content: "Выполни инструкцию над переданным фрагментом таблицы. Верни только реально нужные изменения JSON {changes:[{row,column,value}]}. row — абсолютный индекс строки данных с нуля, column — индекс заголовка с нуля. Не возвращай неизменённые ячейки и таблицу целиком. Соблюдай переданный mapping. Если full_name равен null, а last_name, first_name и middle_name указывают разные колонки, фамилия, имя и отчество должны оставаться в этих отдельных колонках — никогда не объединяй их в одну ячейку.",
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
