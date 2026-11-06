import type { HapticKind, PlatformAdapter, PlatformStorage, SharePayload } from "./types";

/**
 * Capacitor placeholder. Nothing here imports @capacitor/* yet.
 *
 * The real implementation will use:
 *  - @capacitor/preferences for storage;
 *  - @capacitor/haptics for light/success;
 *  - @capacitor/share for sharing, behind S8;
 *  - @capacitor/filesystem to write the PNG into the gallery.
 */
export const capacitorStorage: PlatformStorage = {
  async get<T>(_key: string): Promise<T | null> {
    return null;
  },
  async set<T>(_key: string, _value: T): Promise<void> {
    /* not wired yet */
  },
  async remove(_key: string): Promise<void> {
    /* not wired yet */
  },
};

export const capacitorAdapter: PlatformAdapter = {
  id: "capacitor",
  storage: capacitorStorage,
  haptics(_kind: HapticKind): void {
    /* @capacitor/haptics goes here */
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
