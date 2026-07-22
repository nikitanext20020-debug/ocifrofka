"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DATABASE_NAME = "document-digitizer";
const STORE_NAME = "app-state";
const DATABASE_VERSION = 1;
const identity = <T,>(value: T) => value;

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Не удалось открыть IndexedDB."));
  });
}

async function readIndexedDb<T>(key: string) {
  const database = await openDatabase();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error ?? new Error("Не удалось прочитать IndexedDB."));
    });
  } finally {
    database.close();
  }
}

async function writeIndexedDb<T>(key: string, value: T) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Не удалось записать IndexedDB."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Запись IndexedDB отменена."));
    });
  } finally {
    database.close();
  }
}

function reportStorageError(key: string, error: unknown) {
  window.dispatchEvent(new CustomEvent("storage-write-error", {
    detail: { key, message: error instanceof Error ? error.message : String(error) },
  }));
}

/** Stores large session data in IndexedDB and migrates the old localStorage value once. */
export function useIndexedDbStorage<T>(
  key: string,
  initialValue: T,
  toStoredValue: (value: T) => T = identity,
) {
  const [value, setValue] = useState(initialValue);
  const [ready, setReady] = useState(false);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        let stored = await readIndexedDb<T>(key) as T | undefined;
        if (stored === undefined) {
          const legacyRaw = localStorage.getItem(key);
          if (legacyRaw !== null) {
            stored = JSON.parse(legacyRaw) as T;
            await writeIndexedDb(key, stored);
            localStorage.removeItem(key);
          }
        }
        if (!cancelled && stored !== undefined) {
          valueRef.current = stored;
          setValue(stored);
        }
      } catch (error) {
        if (!cancelled) reportStorageError(key, error);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [key]);

  const update = useCallback((next: T | ((current: T) => T)) => {
    const resolved = typeof next === "function"
      ? (next as (current: T) => T)(valueRef.current)
      : next;
    valueRef.current = resolved;
    setValue(resolved);
    void writeIndexedDb(key, toStoredValue(resolved)).catch((error) => reportStorageError(key, error));
  }, [key, toStoredValue]);

  return [value, update, ready] as const;
}
