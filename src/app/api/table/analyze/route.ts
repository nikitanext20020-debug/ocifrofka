import { z } from "zod";
import { apiError, callStructured, readAgentConfig } from "@/lib/model-client";
import { tableAnalysisSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  headers: z.array(z.string()).min(1).max(300),
  rows: z.array(z.array(z.unknown())).max(20),
});

export async function POST(request: Request) {
  try {
    const config = readAgentConfig(request);
    const body = bodySchema.parse(await request.json());
    const result = await callStructured({
      config,
      schema: tableAnalysisSchema,
      messages: [
        {
          role: "system",
          content: `Ты анализируешь таблицу обращений. Верни JSON с mapping и formats. mapping содержит topic, full_name, birth_date, address, phone; значение — индекс колонки с нуля или null. formats содержит для каждого поля краткое описание фактического формата. Не изменяй данные. Индексы должны существовать в headers.`,
        },
        { role: "user", content: JSON.stringify(body) },
      ],
    });
    for (const value of Object.values(result.mapping)) {
      if (value !== null && value >= body.headers.length) {
        return Response.json({ error: "Модель указала несуществующую колонку. Повторите анализ." }, { status: 502 });
      }
    }
    return Response.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Таблица не содержит данных для анализа." }, { status: 400 });
    }
    return apiError(error);
  }
}
