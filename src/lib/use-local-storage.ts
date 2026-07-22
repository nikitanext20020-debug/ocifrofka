"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

const listeners = new Map<string, Set<() => void>>();
const cache = new Map<string, { raw: string | null; value: unknown }>();
const identity = <T,>(value: T) => value;
export const SETTINGS_STORAGE_KEY = "digitizer-settings";
export const SETTINGS_BACKUP_KEY = "digitizer-settings-backup";

function subscribe(key: string, listener: () => void) {
  const keyListeners = listeners.get(key) ?? new Set();
  keyListeners.add(listener);
  listeners.set(key, keyListeners);

  const onStorage = (event: StorageEvent) => {
    if (event.key === key) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    keyListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function notify(key: string) {
  listeners.get(key)?.forEach((listener) => listener());
}

function isValidJson(raw: string | null) {
  if (raw === null) return false;
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

function dispatchStorageEvent(name: string, detail: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function writeRaw(key: string, raw: string, value: unknown) {
  try {
    const previousRaw = localStorage.getItem(key);
    if (
      key === SETTINGS_STORAGE_KEY
      && previousRaw !== null
      && previousRaw !== raw
      && isValidJson(previousRaw)
    ) {
      localStorage.setItem(SETTINGS_BACKUP_KEY, previousRaw);
      if (localStorage.getItem(SETTINGS_BACKUP_KEY) !== previousRaw) {
        throw new Error("Не удалось проверить резервную копию настроек.");
      }
    }

    localStorage.setItem(key, raw);
    if (localStorage.getItem(key) !== raw) {
      throw new Error("Контрольное чтение не совпало с записанными данными.");
    }
    cache.set(key, { raw, value });
    notify(key);
    dispatchStorageEvent("storage-write-success", { key });
    return true;
  } catch (error) {
    dispatchStorageEvent("storage-write-error", {
      key,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export function hasRestorableSettingsBackup() {
  if (typeof window === "undefined") return false;
  return isValidJson(localStorage.getItem(SETTINGS_BACKUP_KEY));
}

export function restoreSettingsBackup() {
  if (typeof window === "undefined") return false;
  const backup = localStorage.getItem(SETTINGS_BACKUP_KEY);
  if (!isValidJson(backup)) return false;
  const parsed = JSON.parse(backup!);
  const value = parsed && typeof parsed === "object" && "settings" in parsed ? parsed.settings : parsed;
  return writeRaw(SETTINGS_STORAGE_KEY, backup!, value);
}

export function resetCorruptedSettings<T>(fallback: T, version?: number) {
  if (typeof window === "undefined") return false;
  const raw = JSON.stringify(version !== undefined ? { version, settings: fallback } : fallback);
  return writeRaw(SETTINGS_STORAGE_KEY, raw, fallback);
}

export function readStored<T>(
  key: string,
  fallback: T,
  version?: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  migrate?: (stored: any) => T,
): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;

    const current = cache.get(key);
    if (current?.raw === raw) return current.value as T;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Keep the corrupted source untouched. Preserve one fixed backup only;
      // prefer a previously known-good copy when it exists.
      try {
        if (key === SETTINGS_STORAGE_KEY && !hasRestorableSettingsBackup()) {
          localStorage.setItem(SETTINGS_BACKUP_KEY, raw);
        }
      } catch {}
      cache.set(key, { raw, value: fallback });
      dispatchStorageEvent("storage-parse-error", {
        key,
        canRestore: key === SETTINGS_STORAGE_KEY && hasRestorableSettingsBackup(),
      });
      return fallback;
    }

    let value: T;
    if (version !== undefined && migrate) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inner = parsed && typeof parsed === "object" && "settings" in (parsed as any) ? (parsed as any).settings : parsed;
      if (parsed && typeof parsed === "object" && "version" in parsed && "settings" in parsed) {
        if (parsed.version < version) {
          value = migrate(inner);
          const migratedRaw = JSON.stringify({ version, settings: value });
          writeRaw(key, migratedRaw, value);
          return value;
        } else {
          value = parsed.settings as T;
        }
      } else {
        // Old format (unversioned)
        value = migrate(inner);
        const migratedRaw = JSON.stringify({ version, settings: value });
        writeRaw(key, migratedRaw, value);
        return value;
      }
    } else {
      value = parsed as T;
    }

    cache.set(key, { raw, value });
    return value;
  } catch {
    return fallback;
  }
}

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
  toStoredValue: (value: T) => T = identity,
  version?: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  migrate?: (stored: any) => T,
) {
  const subscribeToKey = useCallback((listener: () => void) => subscribe(key, listener), [key]);
  const getSnapshot = useCallback(() => readStored(key, initialValue, version, migrate), [initialValue, key, version, migrate]);
  const getServerSnapshot = useMemo(() => () => initialValue, [initialValue]);
  const value = useSyncExternalStore(subscribeToKey, getSnapshot, getServerSnapshot);

  // Initialize store if key doesn't exist. Never overwrite existing values.
  useEffect(() => {
    try {
      if (localStorage.getItem(key) === null) {
        const payload = toStoredValue(value);
        const raw = JSON.stringify(version !== undefined ? { version, settings: payload } : payload);
        writeRaw(key, raw, value);
      }
    } catch {
      dispatchStorageEvent("storage-write-error", { key });
    }
  }, [key, toStoredValue, value, version]);

  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      const current = readStored(key, initialValue, version, migrate);
      const resolved = typeof next === "function" ? (next as (current: T) => T)(current) : next;
      try {
        const payload = toStoredValue(resolved);
        const raw = JSON.stringify(version !== undefined ? { version, settings: payload } : payload);
        return writeRaw(key, raw, resolved);
      } catch (error) {
        dispatchStorageEvent("storage-write-error", {
          key,
          message: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    },
    [initialValue, key, toStoredValue, version, migrate],
  );

  return [value, update, true] as const;
}
