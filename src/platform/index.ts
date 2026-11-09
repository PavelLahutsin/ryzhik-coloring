import { capacitorAdapter, initializeCapacitor } from "./capacitor";
import type { PlatformAdapter } from "./types";
import { activateVkAdapter, isVkLaunch, vkAdapter } from "./vk";
import { webAdapter } from "./web";

export type { HapticKind, PlatformAdapter, PlatformStorage, SharePayload } from "./types";

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

/**
 * True only inside the Capacitor Android/iOS shell. Loading the Capacitor
 * script in a browser leaves `isNativePlatform()` false, so the site stays web.
 */
function isCapacitorNative(): boolean {
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === "function") return cap.isNativePlatform() === true;
  const name = cap.getPlatform?.();
  return name === "android" || name === "ios";
}

/**
 * Native shell, then a real VK launch, otherwise the normal browser.
 * VK Bridge is started only when `vk_*` launch parameters are present.
 */
export function detectPlatform(): PlatformAdapter {
  if (isCapacitorNative()) {
    initializeCapacitor();
    return capacitorAdapter;
  }
  if (isVkLaunch()) {
    activateVkAdapter();
    return vkAdapter;
  }
  return webAdapter;
}

export const platform: PlatformAdapter = detectPlatform();
