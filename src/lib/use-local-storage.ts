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

function readStored<T>(key: string, fallback: T) {
  try {
    const raw = localStorage.getItem(key);
    const current = cache.get(key);
    if (current?.raw === raw) return current.value as T;
    const value = raw ? (JSON.parse(raw) as T) : fallback;
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
) {
  const subscribeToKey = useCallback((listener: () => void) => subscribe(key, listener), [key]);
  const getSnapshot = useCallback(() => readStored(key, initialValue), [initialValue, key]);
  const getServerSnapshot = useMemo(() => () => initialValue, [initialValue]);
  const value = useSyncExternalStore(subscribeToKey, getSnapshot, getServerSnapshot);

  useEffect(() => {
    try {
      const raw = JSON.stringify(toStoredValue(value));
      if (localStorage.getItem(key) === raw) return;
      localStorage.setItem(key, raw);
      cache.set(key, { raw, value });
      notify(key);
    } catch {
      window.dispatchEvent(new CustomEvent("storage-quota-error"));
    }
  }, [key, toStoredValue, value]);

  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      const current = readStored(key, initialValue);
      const resolved = typeof next === "function" ? (next as (current: T) => T)(current) : next;
      try {
        const raw = JSON.stringify(toStoredValue(resolved));
        localStorage.setItem(key, raw);
        // Keep the complete value in memory for the current tab. The persisted
        // representation may intentionally omit bulky, non-essential fields.
        cache.set(key, { raw, value: resolved });
        notify(key);
      } catch {
        window.dispatchEvent(new CustomEvent("storage-quota-error"));
      }
    },
    [initialValue, key, toStoredValue],
  );

  return [value, update, true] as const;
}
