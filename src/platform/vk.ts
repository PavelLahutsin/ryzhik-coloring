import bridge from "@vkontakte/vk-bridge";
import { idb } from "./idb";
import type { HapticKind, PlatformAdapter, PlatformStorage, SharePayload } from "./types";

type Insets = { top: number; right: number; bottom: number; left: number };

const INIT_MS = 2000;
const STORAGE_MS = 2000;
/** VKWebAppStorageSet rejects values longer than 4096 characters. */
const VK_VALUE_LIMIT = 4000;

let isActive = false;
let bridgeReady = false;
let initialization: Promise<boolean> | null = null;

/** VK launch parameters arrive in the query string, or in the hash on some clients. */
export function isVkLaunch(): boolean {
  if (typeof window === "undefined") return false;
  return readLaunchEntries(window.location.search, window.location.hash).some(
    ([key, value]) => key.startsWith("vk_") && value.length > 0,
  );
}

function readLaunchEntries(search: string, hash: string): [string, string][] {
  const chunks: string[] = [];
  if (search.length > 1) chunks.push(search.startsWith("?") ? search.slice(1) : search);
  const rawHash = hash.startsWith("#") ? hash.slice(1) : hash;
  const nested = rawHash.indexOf("?");
  if (nested >= 0) chunks.push(rawHash.slice(nested + 1));
  else if (/(^|&)vk_[^=&]+=[^&]+/.test(rawHash)) chunks.push(rawHash);
  return chunks.flatMap((query) => Array.from(new URLSearchParams(query).entries()));
}

function finiteInset(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Publish VK insets as CSS variables. A normal browser keeps env() padding. */
function applySafeArea(raw: Partial<Insets> | undefined): void {
  if (!raw || typeof document === "undefined") return;
  const insets: Insets = {
    top: finiteInset(raw.top),
    right: finiteInset(raw.right),
    bottom: finiteInset(raw.bottom),
    left: finiteInset(raw.left),
  };
  const root = document.documentElement;
  for (const side of ["top", "right", "bottom", "left"] as const) {
    root.style.setProperty(`--vk-safe-area-inset-${side}`, `${insets[side]}px`);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

function configureSafeArea(): void {
  bridge.subscribe((event) => {
    if (event.detail?.type !== "VKWebAppUpdateInsets") return;
    applySafeArea(event.detail.data.insets);
  });

  void withTimeout(bridge.send("VKWebAppGetConfig"), STORAGE_MS).then((config) => {
    if (config && "insets" in config && config.insets) applySafeArea(config.insets);
  });
}

/** Called only by platform detection after a vk_* launch parameter is found. */
export function activateVkAdapter(): void {
  if (initialization) return;
  isActive = true;
  initialization = withTimeout(bridge.send("VKWebAppInit"), INIT_MS).then((result) => {
    bridgeReady = result?.result === true;
    if (bridgeReady) configureSafeArea();
    return bridgeReady;
  });
}

async function bridgeUp(): Promise<boolean> {
  if (!isActive || !initialization) return false;
  return initialization;
}

async function readVkValue<T>(key: string): Promise<T | null> {
  if (!(await bridgeUp())) return null;
  const response = await withTimeout(bridge.send("VKWebAppStorageGet", { keys: [key] }), STORAGE_MS);
  if (!response) return null;
  try {
    const entry = response.keys.find((item) => item.key === key);
    if (!entry?.value) return null;
    return JSON.parse(entry.value) as T;
  } catch {
    return null;
  }
}

export const vkStorage: PlatformStorage = {
  async get<T>(key: string): Promise<T | null> {
    const fromVk = await readVkValue<T>(key);
    if (fromVk !== null) {
      await idb.set(key, fromVk);
      return fromVk;
    }
    return idb.get<T>(key);
  },

  async set<T>(key: string, value: T): Promise<void> {
    if (await bridgeUp()) {
      try {
        const encoded = JSON.stringify(value);
        if (encoded.length <= VK_VALUE_LIMIT) {
          await withTimeout(bridge.send("VKWebAppStorageSet", { key, value: encoded }), STORAGE_MS);
        }
      } catch {
        /* IndexedDB below still keeps the value on this device. */
      }
    }
    await idb.set(key, value);
  },

  async remove(key: string): Promise<void> {
    if (await bridgeUp()) {
      await withTimeout(bridge.send("VKWebAppStorageSet", { key, value: "" }), STORAGE_MS);
    }
    await idb.remove(key);
  },
};

export const vkAdapter: PlatformAdapter = {
  id: "vk",
  storage: vkStorage,
  haptics(kind: HapticKind): void {
    if (!isActive || !bridgeReady) return;
    const send =
      kind === "light"
        ? bridge.send("VKWebAppTapticImpactOccurred", { style: "light" })
        : bridge.send("VKWebAppTapticNotificationOccurred", {
            type: kind === "success" ? "success" : "warning",
          });
    void withTimeout(send, 800);
  },
  canShare(): boolean {
    return false;
  },
  async share(_payload: SharePayload): Promise<boolean> {
    return false;
  },
  async saveImage(_dataUrl: string, _filename: string): Promise<boolean> {
    return false;
  },
};
