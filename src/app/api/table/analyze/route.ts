import { z } from "zod";
import { apiError, callStructured, readAgentConfig } from "@/lib/model-client";
import { tableAnalysisSchema } from "@/lib/schemas";
import { refineColumnMapping } from "@/lib/column-mapping";

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
          content: [
            "Ты анализируешь таблицу обращений. Верни JSON с mapping и formats.",
            "mapping содержит все ключи: topic, full_name, last_name, first_name, middle_name, birth_date, address, phone; значение — индекс колонки с нуля или null.",
            "Правила для ФИО:",
            "- если полное ФИО хранится в одной колонке, укажи её в full_name, а last_name, first_name и middle_name сделай null;",
            "- если фамилия, имя и отчество хранятся раздельно, full_name сделай null и укажи соответствующие колонки в last_name, first_name и middle_name;",
            "- определяй раздельные колонки по значениям строк, даже если заголовки технические (D, E, F или Колонка 4, Колонка 5, Колонка 6).",
            "Остальные поля: address — адрес проживания; birth_date — дата рождения; phone — номер мобильного телефона; topic — именно тема/тематика предложения.",
            "Если есть отдельные колонки «Тематика предложения», «Направление обращения» и «Текст наказа», для topic выбирай «Тематика предложения», а не две другие колонки.",
            "formats содержит topic, full_name, birth_date, address, phone и для каждого даёт краткое описание фактического формата.",
            "Не изменяй данные. Индексы должны существовать в headers. Не назначай одну колонку разным частям ФИО.",
          ].join("\n"),
        },
        { role: "user", content: JSON.stringify(body) },
      ],
    });
    result.mapping = refineColumnMapping(body.headers, body.rows, result.mapping);
    const hasSeparateNameColumns = result.mapping.last_name !== null ||
      result.mapping.first_name !== null || result.mapping.middle_name !== null;
    if (hasSeparateNameColumns) result.mapping.full_name = null;

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
