export const RECORD_FIELDS = [
  "topic",
  "full_name",
  "birth_date",
  "address",
  "phone",
] as const;

export type RecordField = (typeof RECORD_FIELDS)[number];

export const NAME_PART_FIELDS = [
  "last_name",
  "first_name",
  "middle_name",
] as const;

export type NamePartField = (typeof NAME_PART_FIELDS)[number];
export type MappableField = RecordField | NamePartField;

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

export type TableAgent = AgentConfig & {
  id: string;
  name: string;
};

export type AppSettings = {
  visionAgents: VisionAgent[];
  activeVisionAgentId: string;
  tableAgents: TableAgent[];
  activeTableAgentId: string;
  parallelRequests: number;
  table?: AgentConfig;
  extractionPrompt: string;
  agentTimeout: number;
  pingHistory?: Record<
    string,
    { latencyMs: number; timestamp: number; error?: string }
  >;
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

export type ColumnMapping = Record<MappableField, number | null>;

export type MappingConflict = {
  field: MappableField;
  /** Column that the header name pointed to. */
  headerColumn: number;
  /** Column that the actual data matches. */
  dataColumn: number;
};

export type TableAnalysis = {
  mapping: ColumnMapping;
  formats: Record<RecordField, string>;
  categoricals: Record<number, string[]>;
  /** Columns where the header name and the data content disagreed. */
  conflicts?: MappingConflict[];
};

export type CellChange = {
  row: number;
  column: number;
  value: string;
};

export type CellMark = "generated" | "custom" | "phone-invalid";
export type CellMarks = Record<string, CellMark>;

export type InsertProgress = {
  startRow: number;
  endRow: number;
  count: number;
};

export type TableSnapshot = {
  workbook: WorkbookData;
  marks: CellMarks;
  newRows: number[];
  syntheticRows: number[];
  categoricalDefaults: Record<number, string>;
  notice: string | null;
  insertProgress: InsertProgress | null;
};

export const FIELD_LABELS: Record<RecordField, string> = {
  topic: "Текст наказа / тема",
  full_name: "ФИО",
  birth_date: "Дата рождения",
  address: "Адрес",
  phone: "Телефон",
};

export const NAME_PART_LABELS: Record<NamePartField, string> = {
  last_name: "Фамилия",
  first_name: "Имя",
  middle_name: "Отчество",
};
