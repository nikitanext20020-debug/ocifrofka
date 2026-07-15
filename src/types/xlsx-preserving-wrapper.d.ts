declare module "xlsx" {
  export type WorkSheet = Record<string, unknown>;

  export type WorkBook = {
    SheetNames: string[];
    Sheets: Record<string, WorkSheet>;
  };

  export const version: string;

  export const utils: {
    sheet_to_json<T = unknown[]>(
      sheet: WorkSheet,
      options?: {
        header?: number;
        raw?: boolean;
        defval?: unknown;
      },
    ): T[];
    book_new(): WorkBook;
    aoa_to_sheet(data: unknown[][]): WorkSheet;
    book_append_sheet(workbook: WorkBook, sheet: WorkSheet, name: string): void;
  };

  export function read(data: unknown, options?: Record<string, unknown>): WorkBook;
  export function writeFile(workbook: WorkBook, fileName: string, options?: Record<string, unknown>): void;
}
