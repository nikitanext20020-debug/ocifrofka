import type { AppSettings, ColumnMapping } from "@/lib/types";

export const DEFAULT_EXTRACTION_PROMPT = `Твоя задача — распознать текст на фото заявления/обращения. Извлеки следующие данные:
- Тема обращения: что человек просит (кратко, своими словами, 1 фраза)
- ФИО: полностью, как написано
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
  table: {
    baseUrl: "https://routerai.ru/api/v1",
    apiKey: "",
    model: "deepseek/deepseek-v4-flash",
  },
  extractionPrompt: DEFAULT_EXTRACTION_PROMPT,
};

export const EMPTY_MAPPING: ColumnMapping = {
  topic: null,
  full_name: null,
  birth_date: null,
  address: null,
  phone: null,
};

export const MAX_FILE_SIZE = 20 * 1024 * 1024;
export const MAX_IMAGE_WIDTH = 2000;
