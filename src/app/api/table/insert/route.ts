import { z } from "zod";
import { apiError, callStructured, readAgentConfig } from "@/lib/model-client";
import { normalizedRecordsSchema } from "@/lib/schemas";
import { normalizeBirthDate } from "@/lib/date-utils";

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
  categoryColumns: z.array(z.object({
    column: z.number().int().nonnegative(),
    header: z.string(),
    values: z.array(z.string()).min(1).max(50),
  })).max(10).optional().default([]),
  instruction: z.string().max(4000).optional().default(""),
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
            "Приведи значения записей к указанным форматам таблицы. Не выдумывай отсутствующие данные и не меняй смысл. Верни JSON {records:[...]}, сохрани порядок и число записей. Поле topic — это исходный «Текст наказа» для колонки M: сохрани его смысл и не заменяй значением тематической категории. Поле full_name всегда возвращай полностью и в порядке «Фамилия Имя Отчество»: не оставляй только фамилию, даже если в целевой таблице фамилия, имя и отчество находятся в отдельных колонках — приложение разделит их самостоятельно. Дату рождения всегда возвращай строго в формате ДД.ММ.ГГГГ, например 18.09.2001. В каждой записи верни также объект categories.",
            Object.keys(body.categoricals).length > 0
              ? `\nДля следующих полей допустимы ТОЛЬКО указанные значения. Если исходное поле заполнено, ОБЯЗАТЕЛЬНО выбери наиболее близкое по смыслу значение из списка и никогда не ставь «-». Прочерк допустим только когда исходное поле само пустое или равно «-»:\n${Object.entries(body.categoricals).map(([field, values]) => `- ${field}: [${values.map((v) => `«${v}»`).join(", ")}]`).join("\n")}`
              : "",
            body.categoryColumns.length > 0
              ? `\nНа основе поля topic каждой записи классифицируй её по производным колонкам. В categories ключом должен быть номер column как строка, а значением — ровно одно значение из соответствующего списка. Верни все перечисленные колонки для каждой записи:\n${body.categoryColumns.map(({ column, header, values }) => `- categories["${column}"] для «${header}»: [${values.map((v) => `«${v}»`).join(", ")}]`).join("\n")}`
              : "\nДля каждой записи верни categories: {}.",
            body.instruction.trim()
              ? `\nСправочная инструкция от оператора: ${body.instruction.trim()}.\nПрименяй её ТОЛЬКО к полю address и только так: если в адресе отсутствует населённый пункт, а улица по инструкции однозначно относится к одному населённому пункту — допиши его в начало адреса (формат: населённый пункт, улица, дом). Улицу, номер дома и квартиру не менять. Если улица есть в нескольких населённых пунктах или в инструкции её нет — оставь адрес как есть. Остальные поля инструкция не меняет. Дописывать можно только населённый пункт, взятый из инструкции, ничего больше.`
              : "",
          ].join(""),
        },
        { role: "user", content: JSON.stringify(body) },
      ],
    });
    if (result.records.length !== body.records.length) {
      return Response.json({ error: "Модель изменила число записей. Повторите вставку." }, { status: 502 });
    }
    const allowed = new Map(body.categoryColumns.map(({ column, values }) => [String(column), new Set(values)]));
    if (allowed.size > 0) {
      const invalid = result.records.some(({ categories }) =>
        [...allowed].some(([column, values]) => !values.has(categories[column])),
      );
      if (invalid) {
        return Response.json({ error: "Модель не смогла выбрать тематику или направление из списка. Повторите вставку." }, { status: 502 });
      }
    }
    result.records = result.records.map((record) => ({
      ...record,
      birth_date: normalizeBirthDate(record.birth_date, body.formats.birth_date),
      categories: Object.fromEntries(
        Object.entries(record.categories).filter(([column, value]) => allowed.get(column)?.has(value)),
      ),
    }));
    return Response.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Нет корректных записей для вставки." }, { status: 400 });
    }
    return apiError(error);
  }
}
