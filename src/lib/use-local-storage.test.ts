import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readStored,
  restoreSettingsBackup,
  SETTINGS_BACKUP_KEY,
  SETTINGS_STORAGE_KEY,
} from "./use-local-storage";

// Since tests run in a "node" environment, we mock localStorage and window objects.
class LocalStorageMock {
  private store: Record<string, string> = {};

  getItem(key: string) {
    return this.store[key] || null;
  }

  setItem(key: string, value: string) {
    this.store[key] = String(value);
  }

  removeItem(key: string) {
    delete this.store[key];
  }

  clear() {
    this.store = {};
  }
}

const mockLocalStorage = new LocalStorageMock();

describe("useLocalStorage / readStored versioning and safety", () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    vi.stubGlobal("localStorage", mockLocalStorage);
    // Mock window dispatchEvent
    vi.stubGlobal("window", {
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("applies migration from older format and updates version", () => {
    const key = "test-settings";
    // Setup unversioned old format in localStorage
    localStorage.setItem(key, JSON.stringify({ parallelRequests: 5, oldField: "foo" }));

    // Define migrate settings helper
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const migrate = (stored: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const settings = stored && "settings" in (stored as any) ? (stored as any).settings : stored;
      return {
        parallelRequests: settings.parallelRequests ?? 4,
        migrated: true,
      };
    };

    const initial = { parallelRequests: 4, migrated: false };

    // Call readStored directly to verify migration
    const value = readStored(key, initial, 1, migrate);

    expect(value).toEqual({ parallelRequests: 5, migrated: true });
    // Verify it saved the migrated format back
    const saved = JSON.parse(localStorage.getItem(key)!);
    expect(saved).toEqual({
      version: 1,
      settings: { parallelRequests: 5, migrated: true },
    });
  });

  it("keeps corrupted settings untouched and uses one fixed backup key", () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, "invalid { json");

    const dispatchMock = vi.fn();
    vi.stubGlobal("window", {
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: dispatchMock,
    });

    const value = readStored(SETTINGS_STORAGE_KEY, { def: "value" });

    // Returns fallback
    expect(value).toEqual({ def: "value" });

    // Dispatches storage-parse-error event
    expect(dispatchMock).toHaveBeenCalled();
    const event = dispatchMock.mock.calls[0][0];
    expect(event.type).toBe("storage-parse-error");

    expect(localStorage.getItem(SETTINGS_BACKUP_KEY)).toBe("invalid { json");

    // The corrupted source is not silently replaced with defaults.
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBe("invalid { json");
  });

  it("restores a valid settings backup over corrupted settings", () => {
    const backup = JSON.stringify({ version: 1, settings: { restored: true } });
    localStorage.setItem(SETTINGS_STORAGE_KEY, "broken");
    localStorage.setItem(SETTINGS_BACKUP_KEY, backup);

    expect(restoreSettingsBackup()).toBe(true);
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBe(backup);
    expect(readStored(SETTINGS_STORAGE_KEY, { restored: false }, 1, (value) => value)).toEqual({ restored: true });
  });
});
