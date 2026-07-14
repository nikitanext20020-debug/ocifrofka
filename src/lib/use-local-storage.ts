"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

const listeners = new Map<string, Set<() => void>>();
const cache = new Map<string, { raw: string | null; value: unknown }>();

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

export function useLocalStorage<T>(key: string, initialValue: T) {
  const subscribeToKey = useCallback((listener: () => void) => subscribe(key, listener), [key]);
  const getSnapshot = useCallback(() => readStored(key, initialValue), [initialValue, key]);
  const getServerSnapshot = useMemo(() => () => initialValue, [initialValue]);
  const value = useSyncExternalStore(subscribeToKey, getSnapshot, getServerSnapshot);

  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      const current = readStored(key, initialValue);
      const resolved = typeof next === "function" ? (next as (current: T) => T)(current) : next;
      try {
        const raw = JSON.stringify(resolved);
        localStorage.setItem(key, raw);
        cache.set(key, { raw, value: resolved });
        notify(key);
      } catch {
        window.dispatchEvent(new CustomEvent("storage-quota-error"));
      }
    },
    [initialValue, key],
  );

  return [value, update, true] as const;
}
