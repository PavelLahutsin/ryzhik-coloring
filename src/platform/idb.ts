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

/** Used only when IndexedDB cannot be opened at all. Small quota, but a
 *  child's last pictures survive instead of vanishing silently. */
const FALLBACK_PREFIX = "ryzhik:idb:";

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
    try {
      localStorage.setItem(FALLBACK_PREFIX + key, JSON.stringify(value));
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
