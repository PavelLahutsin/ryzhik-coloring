import type { HapticKind, PlatformAdapter, PlatformStorage, SharePayload } from "./types";

/**
 * VK Mini App placeholder. Nothing here calls vk-bridge yet.
 *
 * The real implementation will:
 *  - call VKWebAppInit before the first paint of content;
 *  - keep compact state in VKWebAppStorageGet/Set (never the PNG blobs);
 *  - map haptics to VKWebAppTapticNotificationOccurred;
 *  - open VKWebAppShowStoryBox / VKWebAppShowImages for sharing, behind S8;
 *  - keep every external link behind the parental gate.
 */
export const vkStorage: PlatformStorage = {
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

export const vkAdapter: PlatformAdapter = {
  id: "vk",
  storage: vkStorage,
  haptics(_kind: HapticKind): void {
    /* VKWebAppTapticNotificationOccurred goes here */
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
