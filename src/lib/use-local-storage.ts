"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

const listeners = new Map<string, Set<() => void>>();
const cache = new Map<string, { raw: string | null; value: unknown }>();
const identity = <T,>(value: T) => value;

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
      // Backup corrupted data
      try {
        localStorage.setItem(`${key}-backup-${Date.now()}`, raw);
        const fallbackRaw = JSON.stringify(version !== undefined ? { version, settings: fallback } : fallback);
        localStorage.setItem(key, fallbackRaw);
        cache.set(key, { raw: fallbackRaw, value: fallback });
      } catch {
        cache.set(key, { raw, value: fallback });
      }
      window.dispatchEvent(new CustomEvent("storage-parse-error", { detail: { key } }));
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
          localStorage.setItem(key, migratedRaw);
          cache.set(key, { raw: migratedRaw, value });
          return value;
        } else {
          value = parsed.settings as T;
        }
      } else {
        // Old format (unversioned)
        value = migrate(inner);
        const migratedRaw = JSON.stringify({ version, settings: value });
        localStorage.setItem(key, migratedRaw);
        cache.set(key, { raw: migratedRaw, value });
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
        localStorage.setItem(key, raw);
        cache.set(key, { raw, value });
        notify(key);
      }
    } catch {
      window.dispatchEvent(new CustomEvent("storage-quota-error"));
    }
  }, [key, toStoredValue, value, version]);

  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      const current = readStored(key, initialValue, version, migrate);
      const resolved = typeof next === "function" ? (next as (current: T) => T)(current) : next;
      try {
        const payload = toStoredValue(resolved);
        const raw = JSON.stringify(version !== undefined ? { version, settings: payload } : payload);
        localStorage.setItem(key, raw);
        cache.set(key, { raw, value: resolved });
        notify(key);
      } catch {
        window.dispatchEvent(new CustomEvent("storage-quota-error"));
      }
    },
    [initialValue, key, toStoredValue, version, migrate],
  );

  return [value, update, true] as const;
}
