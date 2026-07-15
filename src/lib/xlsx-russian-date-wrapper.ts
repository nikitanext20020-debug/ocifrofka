import * as PreservingXLSX from "@/lib/xlsx-preserving-wrapper";

export const version = PreservingXLSX.version;
export const read = PreservingXLSX.read;
export const writeFile = PreservingXLSX.writeFile;

export const utils = {
  ...PreservingXLSX.utils,
  sheet_to_json<T = unknown[]>(sheet: Parameters<typeof PreservingXLSX.utils.sheet_to_json>[0], options: Record<string, unknown> = {}) {
    return PreservingXLSX.utils.sheet_to_json<T>(sheet, {
      dateNF: "dd.mm.yyyy",
      ...options,
    });
  },
};
