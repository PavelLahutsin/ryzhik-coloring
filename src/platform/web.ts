import type { HapticKind, PlatformAdapter, PlatformStorage, SharePayload } from "./types";

/**
 * Browser storage. localStorage is enough for settings and progress; the
 * callers that need bigger payloads (drafts, gallery) add their own
 * compression or fall back to IndexedDB.
 */
const PREFIX = "ryzhik:";

export const webStorage: PlatformStorage = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  async set<T>(key: string, value: T): Promise<void> {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* Quota exceeded: progress is nice to have, never worth a crash. */
    }
  },
  async remove(key: string): Promise<void> {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      /* ignore */
    }
  },
};

function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* Vibration is optional everywhere. */
  }
}

function download(dataUrl: string, filename: string): boolean {
  try {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    return true;
  } catch {
    return false;
  }
}

export const webAdapter: PlatformAdapter = {
  id: "web",
  storage: webStorage,
  haptics(kind: HapticKind): void {
    vibrate(kind === "success" ? [12, 40, 18] : 10);
  },
  canShare(): boolean {
    return typeof navigator.share === "function";
  },
  async share({ image, text }: SharePayload): Promise<boolean> {
    if (!this.canShare()) return false;
    try {
      const blob = await (await fetch(image)).blob();
      const file = new File([blob], "ryzhik.png", { type: "image/png" });
      await navigator.share({ files: [file], text });
      return true;
    } catch {
      return false;
    }
  },
  async saveImage(dataUrl: string, filename: string): Promise<boolean> {
    return download(dataUrl, filename);
  },
};
