import type { HapticKind, PlatformAdapter, PlatformStorage, SharePayload } from "./types";
import { currentRoute, navigate } from "../router";

type Prefs = typeof import("@capacitor/preferences");
type Haptic = typeof import("@capacitor/haptics");
type ShareModule = typeof import("@capacitor/share");
type Fs = typeof import("@capacitor/filesystem");

let prefs: Promise<Prefs> | undefined;
let haptic: Promise<Haptic> | undefined;
let shareMod: Promise<ShareModule> | undefined;
let fs: Promise<Fs> | undefined;

// Dynamic imports so the GitHub Pages and VK builds never fetch these chunks.
const getPrefs = (): Promise<Prefs> => (prefs ??= import("@capacitor/preferences"));
const getHaptic = (): Promise<Haptic> => (haptic ??= import("@capacitor/haptics"));
const getShare = (): Promise<ShareModule> => (shareMod ??= import("@capacitor/share"));
const getFs = (): Promise<Fs> => (fs ??= import("@capacitor/filesystem"));

export const capacitorStorage: PlatformStorage = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const { value } = await (await getPrefs()).Preferences.get({ key });
      return value === null ? null : (JSON.parse(value) as T);
    } catch {
      return null;
    }
  },
  async set<T>(key: string, value: T): Promise<void> {
    try {
      await (await getPrefs()).Preferences.set({ key, value: JSON.stringify(value) });
    } catch {
      /* A full native store must not crash a tap. */
    }
  },
  async remove(key: string): Promise<void> {
    try {
      await (await getPrefs()).Preferences.remove({ key });
    } catch {
      /* ignore */
    }
  },
};

function fileName(filename: string): string {
  const base = filename.split(/[\\/]/).pop()?.replace(/[^\p{L}\p{N}._-]/gu, "_") || "ryzhik.png";
  return base.toLowerCase().endsWith(".png") ? base : `${base}.png`;
}

async function writePng(dataUrl: string, filename: string): Promise<string | null> {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) return null;
  const { Filesystem, Directory } = await getFs();
  for (const directory of [Directory.Cache, Directory.Documents]) {
    try {
      const written = await Filesystem.writeFile({
        path: `Ryzhik/${fileName(filename)}`,
        data: match[1],
        directory,
        recursive: true,
      });
      return written.uri;
    } catch {
      /* Try the next directory. Cache is enough for the share sheet. */
    }
  }
  return null;
}

async function shareFile(uri: string, text: string): Promise<void> {
  await (await getShare()).Share.share({
    title: "Раскраска с Рыжиком",
    text,
    files: [uri],
    dialogTitle: "Сохранить или поделиться рисунком",
  });
}

export const capacitorAdapter: PlatformAdapter = {
  id: "capacitor",
  storage: capacitorStorage,
  haptics(kind: HapticKind): void {
    void getHaptic()
      .then(({ Haptics, ImpactStyle, NotificationType }) =>
        kind === "light"
          ? Haptics.impact({ style: ImpactStyle.Light })
          : Haptics.notification({
              type: kind === "success" ? NotificationType.Success : NotificationType.Warning,
            }),
      )
      .catch(() => undefined);
  },
  canShare(): boolean {
    return true;
  },
  async share({ image, text }: SharePayload): Promise<boolean> {
    try {
      const uri = await writePng(image, "ryzhik.png");
      if (!uri) return false;
      await shareFile(uri, text);
      return true;
    } catch {
      return false;
    }
  },
  async saveImage(dataUrl: string, filename: string): Promise<boolean> {
    try {
      const uri = await writePng(dataUrl, filename);
      if (!uri) return false;
      await shareFile(uri, "Готовый рисунок Рыжика");
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * Where the Android back button goes.
 * The parental gate and the adult screen always return to the menu: backing
 * into a locked route would bounce straight back to the gate.
 */
export function backAction(routeName: string, canGoBack: boolean): "minimize" | "menu" | "history" {
  if (routeName === "menu") return "minimize";
  // Gate and the adult screen must not bounce. Lullabies goes to the menu so
  // its cleanup stops the track and turns sound.silence back off.
  if (routeName === "gate" || routeName === "parent" || routeName === "lullabies") return "menu";
  return canGoBack ? "history" : "menu";
}

export function initializeCapacitor(): void {
  void import("@capacitor/app")
    .then(({ App }) => {
      void App.addListener("backButton", ({ canGoBack }) => {
        const route = currentRoute();
        if (route.name === "picture") {
          // The colouring screen writes its draft before the route changes.
          window.dispatchEvent(new Event("ryzhik:leave"));
        }
        const consumed = new CustomEvent("ryzhik:back", { cancelable: true });
        window.dispatchEvent(consumed);
        if (consumed.defaultPrevented) return;
        const action = backAction(route.name, canGoBack);
        if (action === "minimize") void App.minimizeApp();
        else if (action === "menu") navigate("/menu");
        else window.history.back();
      });
      void App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) window.dispatchEvent(new Event("ryzhik:background"));
      });
    })
    .catch(() => undefined);
}
