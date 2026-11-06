/**
 * Platform boundary. The app never talks to VK or Capacitor directly: it asks
 * for a capability and gets the implementation for the current shell.
 */
export interface PlatformStorage {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export type HapticKind = "light" | "success" | "warning";

export interface SharePayload {
  /** PNG data URL of the finished picture. */
  image: string;
  text: string;
}

export interface PlatformAdapter {
  readonly id: "web" | "vk" | "capacitor";
  readonly storage: PlatformStorage;
  /** Light tap on paint, richer pulse on reward. Silent where unsupported. */
  haptics(kind: HapticKind): void;
  /** True when shares can leave the app; gates the button in S6a. */
  canShare(): boolean;
  /** Sharing is always behind the parental gate (see S8). */
  share(payload: SharePayload): Promise<boolean>;
  /** Saves a finished PNG to the device gallery. */
  saveImage(dataUrl: string, filename: string): Promise<boolean>;
}
