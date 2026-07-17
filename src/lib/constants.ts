import type { AppSettings, ColumnMapping } from "@/lib/types";

export const DEFAULT_PARALLEL_REQUESTS = 4;
export const MIN_PARALLEL_REQUESTS = 1;
export const MAX_PARALLEL_REQUESTS = 8;

export const DEFAULT_EXTRACTION_PROMPT = `Твоя задача — распознать текст на фото заявления/обращения. Извлеки следующие данные:
- Тема обращения: что человек просит (кратко, своими словами, 1 фраза)
- ФИО: полностью, в порядке «Фамилия Имя Отчество»
- Дата рождения
- Адрес
- Телефон
Переписывай данные точно как в документе, ничего не выдумывай. Если поле отсутствует или написано неразборчиво — поставь прочерк «-». В confidence_notes кратко укажи, что разобрал плохо. Отвечай строго в заданном JSON-формате.`;

export const DEFAULT_SETTINGS: AppSettings = {
  visionAgents: [{
    id: "default-vision-agent",
    name: "Агент распознавания 1",
    baseUrl: "https://anymodel.org/v1/",
    apiKey: "",
    model: "cx/gpt-5.5-review",
  }],
  activeVisionAgentId: "default-vision-agent",
  parallelRequests: DEFAULT_PARALLEL_REQUESTS,
  tableAgents: [{
    id: "default-table-agent",
    name: "Excel-агент 1",
    baseUrl: "https://routerai.ru/api/v1",
    apiKey: "",
    model: "deepseek/deepseek-v4-flash",
  }],
  activeTableAgentId: "default-table-agent",
  table: {
    baseUrl: "https://routerai.ru/api/v1",
    apiKey: "",
    model: "deepseek/deepseek-v4-flash",
  },
  extractionPrompt: DEFAULT_EXTRACTION_PROMPT,
  agentTimeout: 60,
};

export const EMPTY_MAPPING: ColumnMapping = {
  topic: null,
  full_name: null,
  last_name: null,
  first_name: null,
  middle_name: null,
  birth_date: null,
  address: null,
  phone: null,
};

export const MAX_FILE_SIZE = 20 * 1024 * 1024;
export const MAX_IMAGE_WIDTH = 2000;
