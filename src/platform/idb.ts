/**
 * Tiny IndexedDB key/value store. Drafts and drawings are PNG data URLs, which
 * blow through the ~5 MB localStorage quota after a handful of pictures, so the
 * big payloads go here. localStorage stays as a fallback for browsers where
 * IndexedDB is blocked (private mode on some builds).
 */
const DB_NAME = "ryzhik";
const DB_VERSION = 1;
const STORE = "kv";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const tx = db.transaction(STORE, mode);
          const request = action(tx.objectStore(STORE));
          request.onsuccess = () => resolve(request.result as T);
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

/** Used only when IndexedDB cannot be opened at all. localStorage is about
 *  5 MB for the whole origin, so one full-size drawing must not be allowed
 *  to crowd out settings and progress. */
const FALLBACK_PREFIX = "ryzhik:idb:";
/** Everything this app writes starts with this, including settings. */
const APP_PREFIX = "ryzhik:";
/** One value, in characters. A 1280px PNG data URL is smaller than this. */
export const LOCAL_VALUE_LIMIT = 700_000;
/** Sum of every ryzhik:* value. Leaves room under the typical 5 MB quota. */
export const LOCAL_STORAGE_BUDGET = 3_500_000;

export function localStorageUsed(): number {
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(APP_PREFIX)) continue;
      total += key.length + (localStorage.getItem(key)?.length ?? 0);
    }
    return total;
  } catch {
    return LOCAL_STORAGE_BUDGET;
  }
}

/** False when this write would pass the per-value cap or the origin budget. */
export function fitsLocalBudget(key: string, payload: string, limit = LOCAL_VALUE_LIMIT): boolean {
  if (payload.length > limit) return false;
  let existing: string | null = null;
  try {
    existing = localStorage.getItem(key);
  } catch {
    return false;
  }
  const previous = existing?.length ?? 0;
  const keyCost = existing === null ? key.length : 0;
  return localStorageUsed() - previous + payload.length + keyCost <= LOCAL_STORAGE_BUDGET;
}

const fallback = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(FALLBACK_PREFIX + key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set<T>(key: string, value: T): boolean {
    const storageKey = FALLBACK_PREFIX + key;
    try {
      let stored: unknown = value;
      let payload = JSON.stringify(stored);
      // A gallery record carries both the flattened PNG and the paint layer.
      // Drop the paint layer first: the picture still shows, and «Дорисовать»
      // falls back to the flattened image.
      if (
        payload.length > LOCAL_VALUE_LIMIT &&
        stored !== null &&
        typeof stored === "object" &&
        "paint" in stored
      ) {
        const { paint: _paint, ...rest } = stored as { paint?: unknown };
        stored = rest;
        payload = JSON.stringify(stored);
      }
      if (!fitsLocalBudget(storageKey, payload)) return false;
      localStorage.setItem(storageKey, payload);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(FALLBACK_PREFIX + key);
    } catch {
      /* ignore */
    }
  },
};

export const idb = {
  async get<T>(key: string): Promise<T | null> {
    if (!(await open())) return fallback.get<T>(key);
    const value = await run<T | undefined>("readonly", (store) => store.get(key));
    return (value as T | undefined) ?? null;
  },
  async set<T>(key: string, value: T): Promise<boolean> {
    if (!(await open())) return fallback.set(key, value);
    const result = await run<IDBValidKey>("readwrite", (store) => store.put(value, key));
    return result !== null;
  },
  async remove(key: string): Promise<void> {
    if (!(await open())) {
      fallback.remove(key);
      return;
    }
    await run<undefined>("readwrite", (store) => store.delete(key));
  },
};
