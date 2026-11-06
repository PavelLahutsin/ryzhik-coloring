import { capacitorAdapter } from "./capacitor";
import type { PlatformAdapter } from "./types";
import { vkAdapter } from "./vk";
import { webAdapter } from "./web";

export type { HapticKind, PlatformAdapter, PlatformStorage, SharePayload } from "./types";

/**
 * Picks the shell the app is running in. Detection is deliberately cheap and
 * has no side effects, so it is safe at module load.
 *
 * When a real VK/Capacitor build appears, replace the placeholder adapters —
 * callers here do not change.
 */
export function detectPlatform(): PlatformAdapter {
  const win = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean };
    vkBridge?: unknown;
  };

  if (win.Capacitor?.isNativePlatform?.()) return capacitorAdapter;
  if (win.vkBridge) return vkAdapter;
  return webAdapter;
}

export const platform: PlatformAdapter = detectPlatform();
