import type {
  CellChange,
  ColumnMapping,
  ExtractedRecord,
  MappableField,
  NamePartField,
  RecordField,
  TableData,
} from "@/lib/types";
import { NAME_PART_FIELDS, RECORD_FIELDS } from "@/lib/types";
import { findDescriptiveHeaderRowIndex } from "@/lib/column-mapping";

const MAPPABLE_FIELDS = [...RECORD_FIELDS, ...NAME_PART_FIELDS] as const;

