export const RECORD_FIELDS = [
  "topic",
  "full_name",
  "birth_date",
  "address",
  "phone",
] as const;

export type RecordField = (typeof RECORD_FIELDS)[number];

export type ExtractedRecord = Record<RecordField, string> & {
  id: string;
  confidence_notes: string;
  thumbnail: string;
  sourceName: string;
};

export type AgentConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type VisionAgent = AgentConfig & {
  id: string;
  name: string;
};

export type AppSettings = {
  visionAgents: VisionAgent[];
  activeVisionAgentId: string;
  table: AgentConfig;
  extractionPrompt: string;
};

export type TableData = {
  headers: string[];
  rows: unknown[][];
};

export type WorkbookData = {
  fileName: string;
  activeSheet: string;
  sheetOrder: string[];
  sheets: Record<string, TableData>;
};

export type ColumnMapping = Record<RecordField, number | null>;

export type TableAnalysis = {
  mapping: ColumnMapping;
  formats: Record<RecordField, string>;
  categoricals: Record<number, string[]>;
};

export type CellChange = {
  row: number;
  column: number;
  value: string;
};

export type CellMark = "generated" | "custom";
export type CellMarks = Record<string, CellMark>;

export type TableSnapshot = {
  workbook: WorkbookData;
  marks: CellMarks;
  newRows: number[];
  notice: string | null;
};

export const FIELD_LABELS: Record<RecordField, string> = {
  topic: "Тема",
  full_name: "ФИО",
  birth_date: "Дата рождения",
  address: "Адрес",
  phone: "Телефон",
};
