import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readStored } from "./use-local-storage";

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

  it("handles corrupted JSON by backing it up and falling back to default", () => {
    const key = "test-corrupted";
    localStorage.setItem(key, "invalid { json");

    const dispatchMock = vi.fn();
    vi.stubGlobal("window", {
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: dispatchMock,
    });

    const value = readStored(key, { def: "value" });

    // Returns fallback
    expect(value).toEqual({ def: "value" });

    // Dispatches storage-parse-error event
    expect(dispatchMock).toHaveBeenCalled();
    const event = dispatchMock.mock.calls[0][0];
    expect(event.type).toBe("storage-parse-error");

    // Creates backup key in localStorage
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const backupKey = Object.keys((localStorage as any).store).find(k => k.startsWith(`${key}-backup-`));
    expect(backupKey).toBeDefined();
    expect(localStorage.getItem(backupKey!)).toBe("invalid { json");

    // Overwrites corrupted key with clean fallback in localStorage
    expect(localStorage.getItem(key)).toBe(JSON.stringify({ def: "value" }));
  });
});
