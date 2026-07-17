import { z } from "zod";
import { apiError, callStructured, readAgentConfig } from "@/lib/model-client";
import { normalizeBirthDate } from "@/lib/date-utils";
import {
  generatedRowsSchema,
  normalizeGeneratedModelRows,
  type GeneratedRowSource,
} from "@/lib/generated-rows";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  count: z.number().int().min(1).max(100),
  headers: z.array(z.string()).min(1).max(300),
  examples: z.array(z.array(z.unknown())).max(20),
  formats: z.record(z.string(), z.string()).optional().default({}),
  categoricals: z.record(z.string(), z.array(z.string()).min(1).max(50)).optional().default({}),
  fixedValues: z.record(z.string(), z.string()).optional().default({}),
  instruction: z.string().max(3000).optional().default(""),
  sequenceStart: z.number().int().nonnegative().optional().default(0),
  forbiddenTexts: z.array(z.string().max(300)).max(300).optional().default([]),
});

class GeneratedRowsError extends Error {}

const TEXT_STRUCTURES = [
  "сначала конкретный факт или неудобство, затем практичное действие",
  "сначала прямое действие, затем конкретное последствие нынешней проблемы",
  "сначала кто сталкивается с трудностью, затем какое изменение поможет",
  "сначала когда или при каких обстоятельствах возникает проблема, затем что изменить",
  "сначала что перестало справляться или устарело, затем чем это заменить или дополнить",
  "сначала короткое наблюдение, затем какое конкретное действие исправит ситуацию",
  "сначала причина недовольства жителей, затем предложение по улучшению",
  "сначала описание текущего опасного или неудобного участка, затем просьба принять меры безопасности",
  "сначала где именно не хватает инфраструктуры, затем какое именно сооружение или объект там требуется поставить",
  "сначала указание на конкретную проблему в работе ЖКХ или благоустройства, затем необходимое действие для её решения",
  "сначала сравнение с хорошим примером в соседнем районе, затем предложение сделать аналогично здесь",
  "сначала описание неудобства для детей или пожилых людей, затем конкретное изменение",
  "сначала техническое состояние объекта (разрушен, сломан), затем просьба отремонтировать или заменить",
  "сначала указание на мусор или беспорядок, затем требование навести чистоту или установить урны/баки"
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
  const OP_CODES = [903, 905, 906, 909, 910, 915, 916, 920, 925, 926, 929, 930, 950, 960, 965, 977, 985, 999];
  const operator = OP_CODES[(index * 13 + 7) % OP_CODES.length];
  const baseVal = 1000000 + (index * 982451653) % 9000000;
  const subscriber = String(baseVal).padStart(7, "0");
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

function topicQualityIssues(rows: string[][], headers: string[], examples: unknown[][], forbiddenTexts: string[]) {
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
  const normalizedForbidden = forbiddenTexts.map((text) => normalized(text)).filter(Boolean);
  texts.forEach((text, index) => {
    const comparisonTexts = [...exampleTexts, ...texts.slice(0, index), ...normalizedForbidden];
    if (comparisonTexts.some((candidate) => topicSimilarity(text, candidate) >= 0.75)) {
      issues.push("есть обращение, слишком похожее на другое существующее или запрещенное");
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

function validateAndNormalizeRows(sources: GeneratedRowSource[], body: z.infer<typeof bodySchema>) {
  const allRows = normalizeGeneratedModelRows(sources, body.headers);
  const rows = allRows.slice(0, body.count);
  if (!rows.length || rows.every((row) => row.every((value) => !value))) {
    throw new GeneratedRowsError("Модель не вернула значений для колонок таблицы.");
  }

  const examples = new Set(body.examples.map((row) => JSON.stringify(row.map(normalized))));
  const uniqueRows = new Set<string>();
  const normalizationIssues: string[] = [];
  if (allRows.length !== body.count) {
    normalizationIssues.push(`запрошено строк: ${body.count}, получено: ${allRows.length}`);
  }
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
    for (const { column, value } of fixedColumns) row[column] = value;
    for (const { column, values } of categoricalColumns) {
      if (fixedColumns.some((fixed) => fixed.column === column)) continue;
      const canonical = values.find((candidate) => normalized(candidate) === normalized(row[column]));
      if (!canonical) throw new GeneratedRowsError(`Модель выбрала недопустимое значение для колонки «${body.headers[column]}».`);
      row[column] = canonical;
    }

    body.headers.forEach((header, column) => {
      if (normalized(header).includes("дата рождения") && row[column]) {
        row[column] = normalizeBirthDate(row[column], body.formats.birth_date ?? "ДД.ММ.ГГГГ");
      }
    });
    phoneColumns.forEach((column) => {
      row[column] = syntheticPhone(body.sequenceStart + index);
    });

    const key = JSON.stringify(row.map(normalized));
    if (examples.has(key) || uniqueRows.has(key)) normalizationIssues.push("есть строка, совпадающая с другой строкой целиком");
    uniqueRows.add(key);
    return row;
  });
  return {
    rows: normalizedRows,
    qualityIssues: [...new Set([
      ...normalizationIssues,
      ...topicQualityIssues(normalizedRows, body.headers, body.examples, body.forbiddenTexts),
    ])],
  };
}

function rowsForPrompt(rows: unknown[][]) {
  return rows.map((row) => Object.fromEntries(
    row
      .map((value, column) => [String(column), String(value ?? "").trim()] as const)
      .filter(([, value]) => value),
  ));
}

export async function POST(request: Request) {
  try {
    const config = readAgentConfig(request);
    const body = bodySchema.parse(await request.json());
    const columns = body.headers.map((header, index) => ({
      index,
      header,
      ...(body.categoricals[header] ? { allowedValues: body.categoricals[header] } : {}),
      ...(body.fixedValues[header] ? { fixedValue: body.fixedValues[header] } : {}),
    }));
    const TOPICS = ["ЖКХ", "Дороги", "Транспорт", "Медицина", "Образование", "Благоустройство", "Спорт", "Культура", "Безопасность", "Связь"];

    const generate = (retry = false) => callStructured({
      config,
      schema: generatedRowsSchema,
      temperature: retry ? 0.8 : 0.7,
      messages: [
        {
          role: "system",
          content: [
            "Создай только синтетические тестовые строки для проверки заполнения Excel-формы.",
            ` Верни JSON {rows:[{"0":"значение",...}]}: ровно ${body.count} строк. Ключи каждой строки — строковые индексы колонок из columns, начиная с нуля.`,
            " Не полагайся на порядок свойств JSON и не используй заголовки как ключи. Для каждой колонки из columns верни значение по её index; если значение действительно не предусмотрено формой, верни пустую строку.",
            " Не копируй из examples ФИО, адреса, телефоны, электронную почту или целые обращения. Все записи должны отличаться друг от друга и от примеров.",
            " ФИО должны быть вымышленными, но грамматически согласованными. Телефоны, даты рождения, адреса и остальные поля оформляй точно в стиле examples.",
            " Для текста обращения соблюдай пользовательскую инструкцию и стиль примеров, но создавай новый текст.",
            " Каждый текст должен состоять ровно из двух коротких предложений. Меняй порядок: не ставь прямое действие первым в каждой строке. Пиши разговорно, спокойно и без канцелярита.",
            " Второе предложение каждого текста обязано содержать конкретное предлагаемое действие (установить, отремонтировать, добавить, заменить, организовать, расширить...), а не только ожидаемый эффект. Текст — это просьба жителя, а не вывод.",
            " Тема текста относится только к содержанию колонки \"Текст наказа\"; для колонок \"Тематика предложения\" и \"Направление обращения\" выбирай строго из allowedValues.",
            " Не начинай с «Нельзя», «Почему», «Лучше», «Нам бы», «Если можно», «В нашем», «У нас в», «Просим», «Очень просим», «Нужно» или «Необходимо». Не штампуй начала с «В», «Во» и названия населённого пункта. «Хотелось бы» и «Очень ждут» используй не более 1–2 раз во всей подборке.",
            " Не более 40% текстов могут начинаться с повелительного глагола. Используй минимум три разных типа начала: действие, обстоятельство, люди, конкретный факт или наблюдение. Не копируй соседний текст, заменяя только улицу, город или объект. Не используй длинное тире.",
            " Не добавляй политическую принадлежность от имени вымышленных людей: если для колонки вовлечённости доступно значение «Иное», используй его.",
            " Не добавляй пояснений, Markdown и заголовков.",
            body.instruction.trim() ? `\nДополнительная инструкция пользователя:\n${body.instruction.trim()}` : "",
            body.forbiddenTexts.length > 0
              ? `\nНе повторяй темы, формулировки и сюжеты из следующего списка запрещенных текстов (список forbidden):\n${body.forbiddenTexts.slice(-100).map((t) => `- ${t}`).join("\n")}`
              : "",
            `\nДетальный план для каждой строки (тематика и структура текста). Строго следуй указанной теме и структуре, но формулировку плана в результат не копируй:\n${Array.from({ length: body.count }, (_, index) => {
              const topic = TOPICS[index % TOPICS.length];
              const struct = TEXT_STRUCTURES[(index * 5 + (retry ? 1 : 0)) % TEXT_STRUCTURES.length];
              return `${index + 1}: Тема ТЕКСТА обращения = «${topic}». Структура текста = ${struct}.`;
            }).join("\n")}`,
            retry ? "\nПредыдущий вариант оказался слишком шаблонным или нарушил формат. Полностью перепиши строки, особенно начала обращений, и строго соблюдай два коротких предложения." : "",
          ].join(""),
        },
        {
          role: "user",
          content: JSON.stringify({
            count: body.count,
            columns,
            formats: body.formats,
            examples: rowsForPrompt(body.examples),
          }),
        },
      ],
    });

    const first = await generate();
    let firstValidated: ReturnType<typeof validateAndNormalizeRows> | null = null;
    try {
      firstValidated = validateAndNormalizeRows(first.rows, body);
    } catch (error) {
      if (!(error instanceof GeneratedRowsError)) throw error;
    }

    // Retry when: (a) first attempt had a format error, or (b) first attempt has quality issues.
    // In case (b) we still have a usable result, so if retry is worse we fall back to it.
    if (!firstValidated || firstValidated.qualityIssues.length) {
      const second = await generate(true);
      try {
        const secondValidated = validateAndNormalizeRows(second.rows, body);
        // Prefer the result with fewer quality problems.
        const best =
          firstValidated &&
          firstValidated.qualityIssues.length <= secondValidated.qualityIssues.length
            ? firstValidated
            : secondValidated;
        return Response.json({
          rows: best.rows,
          ...(best.qualityIssues.length
            ? { warning: `Строки созданы, но проверьте результат: ${best.qualityIssues.join("; ")}.` }
            : {}),
        });
      } catch (retryError) {
        if (!(retryError instanceof GeneratedRowsError)) throw retryError;
        // Retry also had a format error.
        if (firstValidated) {
          // First attempt was valid — return it with its original warning.
          return Response.json({
            rows: firstValidated.rows,
            ...(firstValidated.qualityIssues.length
              ? { warning: `Строки созданы, но проверьте результат: ${firstValidated.qualityIssues.join("; ")}.` }
              : {}),
          });
        }
        return Response.json({ error: retryError.message }, { status: 502 });
      }
    }

    // First attempt was valid and had no quality issues.
    return Response.json({ rows: firstValidated.rows });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Проверьте количество строк и инструкцию генератора." }, { status: 400 });
    }
    return apiError(error);
  }
}
