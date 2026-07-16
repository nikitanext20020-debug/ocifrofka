import { z } from "zod";
import { apiError, callStructured, readAgentConfig } from "@/lib/model-client";
import { normalizeBirthDate } from "@/lib/date-utils";

export const runtime = "nodejs";
export const maxDuration = 120;

const generatedCellSchema = z.preprocess(
  (value) => value === null || value === undefined ? "" : String(value),
  z.string(),
);

const generatedRowsSchema = z.preprocess(
  (value) => {
    if (Array.isArray(value)) return { rows: value };
    if (value && typeof value === "object") {
      if ("data" in value && Array.isArray(value.data)) return { rows: value.data };
      if ("generatedRows" in value && Array.isArray(value.generatedRows)) return { rows: value.generatedRows };
    }
    return value;
  },
  z.object({ rows: z.array(z.array(generatedCellSchema)) }),
);

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

function isPhoneHeader(header: string) {
  const value = normalized(header);
  return value.includes("телефон") || value.includes("номер мобильного");
}

function syntheticPhone(index: number) {
  // Keep generated test data obviously synthetic, but varied enough to avoid
  // looking like a placeholder copied into every row. The leading plus is
  // intentionally omitted because spreadsheets may parse it as a formula.
  const operator = 900 + ((index * 47 + 13) % 100);
  const subscriber = String((1_000_003 + index * 7_919) % 10_000_000).padStart(7, "0");
  return `7(${operator})${subscriber.slice(0, 3)}-${subscriber.slice(3, 5)}-${subscriber.slice(5)}`;
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

function topicQualityIssues(rows: string[][], headers: string[], examples: unknown[][]) {
  const issues: string[] = [];
  const topicColumn = headers.findIndex((header) => normalized(header) === "текст наказа");
  if (topicColumn < 0) return issues;
  const texts = rows.map((row) => row[topicColumn]?.trim() ?? "");
  if (texts.some((text) => (text.match(/[.!?](?:\s|$)/g) ?? []).length !== 2 || text.length > 240)) {
    issues.push("не все обращения состоят из двух коротких предложений");
  }
  if (texts.some((text) => /[—–]/.test(text))) {
    issues.push("в некоторых обращениях использовано длинное тире");
  }
  if (new Set(texts.map(normalized)).size !== texts.length) {
    issues.push("есть повторяющиеся обращения");
  }

  const normalizedTexts = texts.map(normalized);
  if (normalizedTexts.some((text) => /^(нельзя|почему|лучше|нам бы|если можно|в нашем|у нас в|просим|очень просим|нужно|необходимо)\b/.test(text))) {
    issues.push("использован шаблонный зачин");
  }
  const limitedStartMaximum = Math.min(2, Math.max(1, Math.floor(texts.length / 5)));
  for (const limited of ["хотелось бы", "очень ждут"]) {
    if (normalizedTexts.filter((text) => text.startsWith(limited)).length > limitedStartMaximum) {
      issues.push(`слишком часто используется зачин «${limited}»`);
    }
  }

  const exampleTexts = examples
    .map((row) => String(row[topicColumn] ?? "").trim())
    .filter(Boolean);
  texts.forEach((text, index) => {
    const comparisonTexts = [...exampleTexts, ...texts.slice(0, index)];
    if (comparisonTexts.some((candidate) => topicSimilarity(text, candidate) >= 0.75)) {
      issues.push("есть обращение, слишком похожее на соседнее или исходное");
    }
  });

  if (texts.length < 5) return [...new Set(issues)];
  const starts = normalizedTexts.map((text) => (text.match(/[a-zа-я0-9]+/gi) ?? []).slice(0, 2));
  const firstWords = starts.map(([first = ""]) => first);
  const imperativeStarts = firstWords.filter((word) => /(?:йте|ите|ьте)$/.test(word)).length;
  if (imperativeStarts > Math.ceil(texts.length * 0.4)) {
    issues.push("слишком много обращений начинаются с повелительного глагола");
  }
  const prepositionStarts = starts.filter(([first]) => ["в", "во", "на"].includes(first)).length;
  if (prepositionStarts > Math.ceil(texts.length * 0.4)) {
    issues.push("слишком много обращений начинаются с «В», «Во» или «На»");
  }

  const startCounts = new Map<string, number>();
  for (const start of starts) {
    const key = start.join(" ");
    startCounts.set(key, (startCounts.get(key) ?? 0) + 1);
  }
  if ([...startCounts.values()].some((count) => count > 2)) {
    issues.push("слишком часто повторяется одинаковое начало обращения");
  }
  return [...new Set(issues)];
}

function validateAndNormalizeRows(rows: string[][], body: z.infer<typeof bodySchema>) {
  if (rows.length !== body.count || rows.some((row) => row.length !== body.headers.length)) {
    throw new GeneratedRowsError("Модель вернула неправильное количество строк или колонок.");
  }

  const examples = new Set(body.examples.map((row) => JSON.stringify(row.map(normalized))));
  const uniqueRows = new Set<string>();
  const categoricalColumns = Object.entries(body.categoricals)
    .map(([header, values]) => ({ column: body.headers.indexOf(header), values }))
    .filter(({ column }) => column >= 0);
  const fixedColumns = Object.entries(body.fixedValues)
    .map(([header, value]) => ({ column: body.headers.indexOf(header), value }))
    .filter(({ column, value }) => column >= 0 && value.trim());
  const phoneColumns = body.headers
    .map((header, column) => ({ header, column }))
    .filter(({ header }) => isPhoneHeader(header))
    .map(({ column }) => column);

  const normalizedRows = rows.map((source, index) => {
    const row = source.map((value) => String(value ?? "").trim());
    for (const { column, values } of categoricalColumns) {
      const canonical = values.find((candidate) => normalized(candidate) === normalized(row[column]));
      if (!canonical) throw new GeneratedRowsError(`Модель выбрала недопустимое значение для колонки «${body.headers[column]}».`);
      row[column] = canonical;
    }
    for (const { column, value } of fixedColumns) row[column] = value;

    body.headers.forEach((header, column) => {
      if (normalized(header).includes("дата рождения") && row[column]) {
        row[column] = normalizeBirthDate(row[column], body.formats.birth_date ?? "ДД.ММ.ГГГГ");
      }
    });
    phoneColumns.forEach((column) => {
      row[column] = syntheticPhone(index);
    });

    const key = JSON.stringify(row.map(normalized));
    if (examples.has(key) || uniqueRows.has(key)) throw new GeneratedRowsError("Модель повторила существующую строку.");
    uniqueRows.add(key);
    return row;
  });
  return {
    rows: normalizedRows,
    qualityIssues: topicQualityIssues(normalizedRows, body.headers, body.examples),
  };
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
      const firstValidated = validateAndNormalizeRows(first.rows, body);
      if (!firstValidated.qualityIssues.length) return Response.json(firstValidated);

      const second = await generate(true);
      try {
        const secondValidated = validateAndNormalizeRows(second.rows, body);
        return Response.json({
          ...secondValidated,
          ...(secondValidated.qualityIssues.length
            ? { warning: `Строки созданы, но проверьте тексты: ${secondValidated.qualityIssues.join("; ")}.` }
            : {}),
        });
      } catch (retryError) {
        if (!(retryError instanceof GeneratedRowsError)) throw retryError;
        return Response.json({
          rows: firstValidated.rows,
          warning: `Строки созданы, но повторная проверка не улучшила тексты: ${firstValidated.qualityIssues.join("; ")}.`,
        });
      }
    } catch (error) {
      if (!(error instanceof GeneratedRowsError)) throw error;
      const second = await generate(true);
      try {
        const secondValidated = validateAndNormalizeRows(second.rows, body);
        return Response.json({
          ...secondValidated,
          ...(secondValidated.qualityIssues.length
            ? { warning: `Строки созданы, но проверьте тексты: ${secondValidated.qualityIssues.join("; ")}.` }
            : {}),
        });
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
