import { z } from "zod";
import { apiError, callStructured, readAgentConfig } from "@/lib/model-client";
import { normalizedRecordsSchema } from "@/lib/schemas";

export const runtime = "nodejs";

const recordSchema = z.object({
  topic: z.string(),
  full_name: z.string(),
  birth_date: z.string(),
  address: z.string(),
  phone: z.string(),
});

const bodySchema = z.object({
  records: z.array(recordSchema).min(1).max(200),
  formats: z.record(z.string(), z.string()),
});

export async function POST(request: Request) {
  try {
    const config = readAgentConfig(request);
    const body = bodySchema.parse(await request.json());
    const result = await callStructured({
      config,
      schema: normalizedRecordsSchema,
      messages: [
        {
          role: "system",
          content: "Приведи значения записей к указанным форматам таблицы. Не выдумывай отсутствующие данные и не меняй смысл. Верни JSON {records:[...]}, сохрани порядок и число записей.",
        },
        { role: "user", content: JSON.stringify(body) },
      ],
    });
    if (result.records.length !== body.records.length) {
      return Response.json({ error: "Модель изменила число записей. Повторите вставку." }, { status: 502 });
    }
    return Response.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Нет корректных записей для вставки." }, { status: 400 });
    }
    return apiError(error);
  }
}
