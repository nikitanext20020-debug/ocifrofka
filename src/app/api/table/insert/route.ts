import { z } from "zod";
import { apiError, callStructured, readAgentConfig } from "@/lib/model-client";
import { normalizedRecordsSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 120;

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
  categoricals: z.record(z.string(), z.array(z.string())).optional().default({}),
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
          content: [
            "Приведи значения записей к указанным форматам таблицы. Не выдумывай отсутствующие данные и не меняй смысл. Верни JSON {records:[...]}, сохрани порядок и число записей. Поле full_name всегда возвращай полностью и в порядке «Фамилия Имя Отчество»: не оставляй только фамилию, даже если в целевой таблице фамилия, имя и отчество находятся в отдельных колонках — приложение разделит их самостоятельно.",
            Object.keys(body.categoricals).length > 0
              ? `\nДля следующих полей допустимы ТОЛЬКО указанные значения (выбери наиболее подходящее по смыслу). Если ни одно не подходит — ставь «-»:\n${Object.entries(body.categoricals).map(([field, values]) => `- ${field}: [${values.map((v) => `«${v}»`).join(", ")}]`).join("\n")}`
              : "",
          ].join(""),
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
