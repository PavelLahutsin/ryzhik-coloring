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

export const idb = {
  async get<T>(key: string): Promise<T | null> {
    const value = await run<T | undefined>("readonly", (store) => store.get(key));
    return (value as T | undefined) ?? null;
  },
  async set<T>(key: string, value: T): Promise<boolean> {
    const result = await run<IDBValidKey>("readwrite", (store) => store.put(value, key));
    return result !== null;
  },
  async remove(key: string): Promise<void> {
    await run<undefined>("readwrite", (store) => store.delete(key));
  },
};
