import { z } from "zod";
import { apiError, callStructured, readAgentConfig } from "@/lib/model-client";
import { normalizeBirthDate } from "@/lib/date-utils";

export const runtime = "nodejs";
export const maxDuration = 120;

const generatedRowsSchema = z.object({
  rows: z.array(z.array(z.string())),
});

const bodySchema = z.object({
  count: z.number().int().min(1).max(100),
  headers: z.array(z.string()).min(1).max(300),
  examples: z.array(z.array(z.unknown())).max(20),
  formats: z.record(z.string(), z.string()).optional().default({}),
  categoricals: z.record(z.string(), z.array(z.string()).min(1).max(50)).optional().default({}),
  fixedValues: z.record(z.string(), z.string()).optional().default({}),
  instruction: z.string().max(3000).optional().default(""),
});

class GeneratedRowsError extends Error {}

const TEXT_STRUCTURES = [
  "сначала конкретный факт или неудобство, затем практичное действие",
  "сначала прямое действие, затем конкретное последствие нынешней проблемы",
  "сначала кто сталкивается с трудностью, затем какое изменение поможет",
  "сначала когда или при каких обстоятельствах возникает проблема, затем что изменить",
  "сначала что перестало справляться или устарело, затем чем это заменить или дополнить",
  "сначала короткое наблюдение, затем ожидаемый результат без слов «нужно» и «необходимо»",
] as const;

function normalized(value: unknown) {
  return String(value ?? "")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/\s+/g, " ")
    .trim();
}

function topicWords(value: string) {
  return new Set((normalized(value).match(/[a-zа-я0-9]+/gi) ?? []).filter((word) => word.length > 2));
}

function topicSimilarity(left: string, right: string) {
  const leftWords = topicWords(left);
  const rightWords = topicWords(right);
  if (leftWords.size < 4 || rightWords.size < 4) return 0;
  const shared = [...leftWords].filter((word) => rightWords.has(word)).length;
  return shared / new Set([...leftWords, ...rightWords]).size;
}

function validateTopicVariety(rows: string[][], headers: string[], examples: unknown[][]) {
  const topicColumn = headers.findIndex((header) => normalized(header) === "текст наказа");
  if (topicColumn < 0) return;
  const texts = rows.map((row) => row[topicColumn]?.trim() ?? "");
  if (texts.some((text) => (text.match(/[.!?](?:\s|$)/g) ?? []).length !== 2 || text.length > 240)) {
    throw new GeneratedRowsError("Модель не выдержала формат из двух коротких предложений.");
  }
  if (texts.some((text) => /[—–]/.test(text))) {
    throw new GeneratedRowsError("Модель использовала длинное тире.");
  }
  if (new Set(texts.map(normalized)).size !== texts.length) {
    throw new GeneratedRowsError("Модель повторила текст обращения.");
  }

  const normalizedTexts = texts.map(normalized);
  if (normalizedTexts.some((text) => /^(нельзя|почему|лучше|нам бы|если можно|в нашем|у нас в|просим|очень просим|нужно|необходимо)\b/.test(text))) {
    throw new GeneratedRowsError("Модель использовала запрещённый шаблонный зачин.");
  }
  const limitedStartMaximum = Math.min(2, Math.max(1, Math.floor(texts.length / 5)));
  for (const limited of ["хотелось бы", "очень ждут"]) {
    if (normalizedTexts.filter((text) => text.startsWith(limited)).length > limitedStartMaximum) {
      throw new GeneratedRowsError(`Модель слишком часто использовала зачин «${limited}».`);
    }
  }

  const exampleTexts = examples
    .map((row) => String(row[topicColumn] ?? "").trim())
    .filter(Boolean);
  texts.forEach((text, index) => {
    const comparisonTexts = [...exampleTexts, ...texts.slice(0, index)];
    if (comparisonTexts.some((candidate) => topicSimilarity(text, candidate) >= 0.75)) {
      throw new GeneratedRowsError("Модель скопировала соседний текст, изменив только детали.");
    }
  });

  if (texts.length < 5) return;
  const starts = normalizedTexts.map((text) => (text.match(/[a-zа-я0-9]+/gi) ?? []).slice(0, 2));
  const firstWords = starts.map(([first = ""]) => first);
  const imperativeStarts = firstWords.filter((word) => /(?:йте|ите|ьте)$/.test(word)).length;
  if (imperativeStarts > Math.ceil(texts.length * 0.4)) {
    throw new GeneratedRowsError("Слишком много обращений начинаются с повелительного глагола.");
  }
  const prepositionStarts = starts.filter(([first]) => ["в", "во", "на"].includes(first)).length;
  if (prepositionStarts > Math.ceil(texts.length * 0.4)) {
    throw new GeneratedRowsError("Слишком много обращений начинаются с «В», «Во» или «На».");
  }

  const startCounts = new Map<string, number>();
  for (const start of starts) {
    const key = start.join(" ");
    startCounts.set(key, (startCounts.get(key) ?? 0) + 1);
  }
  if ([...startCounts.values()].some((count) => count > 2)) {
    throw new GeneratedRowsError("Модель слишком часто повторила одинаковое начало обращения.");
  }

  const structureBuckets = firstWords.map((word) => {
    if (/(?:йте|ите|ьте)$/.test(word)) return "imperative";
    if (["в", "во", "на"].includes(word)) return "location";
    if (["после", "когда", "каждый", "каждое", "зимой", "летом", "утром", "вечером", "сейчас"].includes(word)) return "circumstance";
    if (["детям", "жителям", "родителям", "пассажирам", "водителям", "пешеходам", "пожилым", "школьникам"].includes(word)) return "people";
    return "other";
  });
  const bucketCounts = new Map<string, number>();
  structureBuckets.forEach((bucket) => bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1));
  if (bucketCounts.size < 3 || [...bucketCounts.values()].some((count) => count > Math.ceil(texts.length * 0.55))) {
    throw new GeneratedRowsError("В подборке доминирует одна и та же конструкция предложений.");
  }
}

function validateAndNormalizeRows(rows: string[][], body: z.infer<typeof bodySchema>) {
  if (rows.length !== body.count || rows.some((row) => row.length !== body.headers.length)) {
    throw new Error("Модель вернула неправильное количество строк или колонок.");
  }

  const examples = new Set(body.examples.map((row) => JSON.stringify(row.map(normalized))));
  const uniqueRows = new Set<string>();
  const categoricalColumns = Object.entries(body.categoricals)
    .map(([header, values]) => ({ column: body.headers.indexOf(header), values }))
    .filter(({ column }) => column >= 0);
  const fixedColumns = Object.entries(body.fixedValues)
    .map(([header, value]) => ({ column: body.headers.indexOf(header), value }))
    .filter(({ column, value }) => column >= 0 && value.trim());

  const normalizedRows = rows.map((source) => {
    const row = source.map((value) => String(value ?? "").trim());
    for (const { column, values } of categoricalColumns) {
      const canonical = values.find((candidate) => normalized(candidate) === normalized(row[column]));
      if (!canonical) throw new Error(`Модель выбрала недопустимое значение для колонки «${body.headers[column]}».`);
      row[column] = canonical;
    }
    for (const { column, value } of fixedColumns) row[column] = value;

    body.headers.forEach((header, column) => {
      if (normalized(header).includes("дата рождения") && row[column]) {
        row[column] = normalizeBirthDate(row[column], body.formats.birth_date ?? "ДД.ММ.ГГГГ");
      }
    });

    const key = JSON.stringify(row.map(normalized));
    if (examples.has(key) || uniqueRows.has(key)) throw new Error("Модель повторила существующую строку.");
    uniqueRows.add(key);
    return row;
  });
  validateTopicVariety(normalizedRows, body.headers, body.examples);
  return normalizedRows;
}

export async function POST(request: Request) {
  try {
    const config = readAgentConfig(request);
    const body = bodySchema.parse(await request.json());
    const generate = (retry = false) => callStructured({
      config,
      schema: generatedRowsSchema,
      messages: [
        {
          role: "system",
          content: [
            "Создай только синтетические тестовые строки для проверки заполнения Excel-формы.",
            ` Верни JSON {rows:[...]}: ровно ${body.count} строк, в каждой ровно ${body.headers.length} строковых значений в порядке headers.`,
            " Не копируй из examples ФИО, адреса, телефоны, электронную почту или целые обращения. Все записи должны отличаться друг от друга и от примеров.",
            " ФИО должны быть вымышленными, но грамматически согласованными. Телефоны, даты рождения, адреса и остальные поля оформляй точно в стиле examples.",
            " Для текста обращения соблюдай пользовательскую инструкцию и стиль примеров, но создавай новый текст.",
            " Каждый текст должен состоять ровно из двух коротких предложений. Меняй порядок: не ставь прямое действие первым в каждой строке. Пиши разговорно, спокойно и без канцелярита.",
            " Не начинай с «Нельзя», «Почему», «Лучше», «Нам бы», «Если можно», «В нашем», «У нас в», «Просим», «Очень просим», «Нужно» или «Необходимо». Не штампуй начала с «В», «Во» и названия населённого пункта. «Хотелось бы» и «Очень ждут» используй не более 1–2 раз во всей подборке.",
            " Не более 40% текстов могут начинаться с повелительного глагола. Используй минимум три разных типа начала: действие, обстоятельство, люди, конкретный факт или наблюдение. Не копируй соседний текст, заменяя только улицу, город или объект. Не используй длинное тире.",
            " Не добавляй политическую принадлежность от имени вымышленных людей: если для колонки вовлечённости доступно значение «Иное», используй его.",
            " Не добавляй пояснений, Markdown и заголовков.",
            `\nЗаголовки по порядку:\n${body.headers.map((header, index) => `${index}: ${header}`).join("\n")}`,
            body.examples.length ? `\nПримеры только для формата и стиля:\n${JSON.stringify(body.examples)}` : "",
            Object.keys(body.categoricals).length
              ? `\nДля категориальных колонок используй только эти значения:\n${Object.entries(body.categoricals).map(([header, values]) => `- ${header}: [${values.map((value) => `«${value}»`).join(", ")}]`).join("\n")}`
              : "",
            Object.keys(body.fixedValues).length
              ? `\nФиксированные значения колонок:\n${Object.entries(body.fixedValues).map(([header, value]) => `- ${header}: «${value}»`).join("\n")}`
              : "",
            body.instruction.trim() ? `\nДополнительная инструкция пользователя:\n${body.instruction.trim()}` : "",
            `\nСтруктурный план текстов по порядку строк. Не копируй формулировку плана в результат:\n${Array.from({ length: body.count }, (_, index) => `${index + 1}: ${TEXT_STRUCTURES[(index * 5 + (retry ? 1 : 0)) % TEXT_STRUCTURES.length]}`).join("\n")}`,
            retry ? "\nПредыдущий вариант оказался слишком шаблонным или нарушил формат. Полностью перепиши строки, особенно начала обращений, и строго соблюдай два коротких предложения." : "",
          ].join(""),
        },
        { role: "user", content: JSON.stringify({ count: body.count, headers: body.headers }) },
      ],
    });

    const first = await generate();
    try {
      return Response.json({ rows: validateAndNormalizeRows(first.rows, body) });
    } catch (error) {
      if (!(error instanceof GeneratedRowsError)) throw error;
      const second = await generate(true);
      try {
        return Response.json({ rows: validateAndNormalizeRows(second.rows, body) });
      } catch (retryError) {
        if (retryError instanceof GeneratedRowsError) {
          return Response.json({ error: retryError.message }, { status: 502 });
        }
        throw retryError;
      }
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Проверьте количество строк и инструкцию генератора." }, { status: 400 });
    }
    return apiError(error);
  }
}
