import { findAlbum, type PictureEntry } from "./data/albums";
import { platform } from "./platform";
import { idb } from "./platform/idb";

/**
 * All app state lives on the device. Keys are small and versioned; the big
 * payloads (drafts, gallery) are capped so a child tapping for an hour cannot
 * fill the storage.
 */

export type Settings = {
  /** Magnet ("не выходить за линии") for new pictures. */
  magnet: boolean;
  /** Parent locked the magnet chip, so the child cannot turn it off. */
  magnetLocked: boolean;
  /** Default brush diameter in CSS px, one of BRUSH_SIZES. */
  brushSize: number;
  /** Sound toggles. The sound module reads these through `sound.configure`. */
  music: boolean;
  sounds: boolean;
  voice: boolean;
  /** Reserved for the adult section: nothing is collected while false. */
  analytics: boolean;
};

export type PictureState = {
  /** Last known paint coverage, 0..1. Drives the album dots and S5. */
  ratio: number;
  status: "new" | "draft" | "done";
  updatedAt: number;
};

export type Progress = {
  stars: number;
  /** pictureId -> state */
  pictures: Record<string, PictureState>;
};

export type Draft = {
  pictureId: string;
  /** Paint layer only, as a PNG data URL. */
  paint: string;
  updatedAt: number;
};

export type Drawing = {
  id: string;
  pictureId: string;
  albumId: string | null;
  title: string;
  /** Flattened PNG as a data URL, at most 1280px on the long side. */
  image: string;
  createdAt: number;
};

const SETTINGS_KEY = "settings";
const PROGRESS_KEY = "progress";
const DRAWINGS_KEY = "drawings";
const DRAFT_PREFIX = "draft:";

/** Design doc: keep at most this many drawings, never delete silently. */
export const DRAWING_LIMIT = 200;
export const MAX_DRAFT_AGE_DAYS = 30;

export const BRUSH_SIZES = [8, 16, 26] as const;

export const DEFAULT_SETTINGS: Settings = {
  magnet: true,
  magnetLocked: false,
  brushSize: 16,
  music: true,
  sounds: true,
  voice: true,
  analytics: false,
};

const EMPTY_PROGRESS: Progress = { stars: 0, pictures: {} };

async function read<T>(key: string, fallback: T): Promise<T> {
  const value = await platform.storage.get<T>(key);
  return value ?? fallback;
}

export const store = {
  async settings(): Promise<Settings> {
    const saved = await read<Partial<Settings>>(SETTINGS_KEY, {});
    return { ...DEFAULT_SETTINGS, ...saved };
  },

  async saveSettings(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...(await this.settings()), ...patch };
    await platform.storage.set(SETTINGS_KEY, next);
    return next;
  },

  async progress(): Promise<Progress> {
    const saved = await read<Progress>(PROGRESS_KEY, EMPTY_PROGRESS);
    return { stars: saved.stars ?? 0, pictures: saved.pictures ?? {} };
  },

  async pictureState(pictureId: string): Promise<PictureState | null> {
    return (await this.progress()).pictures[pictureId] ?? null;
  },

  async savePictureState(pictureId: string, patch: Partial<PictureState>): Promise<Progress> {
    const progress = await this.progress();
    const previous = progress.pictures[pictureId] ?? {
      ratio: 0,
      status: "new" as const,
      updatedAt: 0,
    };
    progress.pictures[pictureId] = { ...previous, ...patch, updatedAt: Date.now() };
    await platform.storage.set(PROGRESS_KEY, progress);
    return progress;
  },

  /** One star per finished picture, exactly like the design document. */
  async awardStar(): Promise<Progress> {
    const progress = await this.progress();
    progress.stars += 1;
    await platform.storage.set(PROGRESS_KEY, progress);
    return progress;
  },

  /** Album dots: how many pictures of the album are finished. */
  async albumDone(albumId: string): Promise<{ done: number; total: number }> {
    const album = findAlbum(albumId);
    if (!album) return { done: 0, total: 0 };
    const progress = await this.progress();
    const done = album.pictures.filter(
      (picture) => progress.pictures[picture.id]?.status === "done",
    ).length;
    return { done, total: album.pictures.length };
  },

  /** Drafts are PNG data URLs, so they live in IndexedDB, not localStorage. */
  async draft(pictureId: string): Promise<Draft | null> {
    return idb.get<Draft>(DRAFT_PREFIX + pictureId);
  },

  async saveDraft(pictureId: string, paint: string): Promise<void> {
    const draft: Draft = { pictureId, paint, updatedAt: Date.now() };
    await idb.set(DRAFT_PREFIX + pictureId, draft);
  },

  async clearDraft(pictureId: string): Promise<void> {
    await idb.remove(DRAFT_PREFIX + pictureId);
  },

  /** Newest first. Older entries are kept; the limit is enforced on save. */
  async drawings(): Promise<Drawing[]> {
    const list = await idb.get<Drawing[]>(DRAWINGS_KEY);
    return [...(list ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  },

  async addDrawing(drawing: Drawing): Promise<Drawing[]> {
    const list = (await idb.get<Drawing[]>(DRAWINGS_KEY)) ?? [];
    list.unshift(drawing);
    const trimmed = list.slice(0, DRAWING_LIMIT);
    await idb.set(DRAWINGS_KEY, trimmed);
    return trimmed;
  },

  /** Inserts or replaces by id. S4 uses this so a second "Готово" on the same
   *  picture updates the gallery entry instead of making a duplicate. */
  async upsertDrawing(drawing: Drawing): Promise<Drawing[]> {
    const list = (await idb.get<Drawing[]>(DRAWINGS_KEY)) ?? [];
    const index = list.findIndex((item) => item.id === drawing.id);
    if (index >= 0) list[index] = drawing;
    else list.unshift(drawing);
    const trimmed = list.slice(0, DRAWING_LIMIT);
    await idb.set(DRAWINGS_KEY, trimmed);
    return trimmed;
  },

  async findDrawing(id: string): Promise<Drawing | null> {
    return (await this.drawings()).find((drawing) => drawing.id === id) ?? null;
  },

  async removeDrawing(id: string): Promise<Drawing[]> {
    const list = ((await idb.get<Drawing[]>(DRAWINGS_KEY)) ?? []).filter(
      (item) => item.id !== id,
    );
    await idb.set(DRAWINGS_KEY, list);
    return list;
  },

  /** Adult-only action, always behind the parental gate. */
  async resetProgress(): Promise<void> {
    await platform.storage.remove(PROGRESS_KEY);
    await idb.remove(DRAWINGS_KEY);
  },
};

export function pictureTitle(picture: PictureEntry | null, fallback: string): string {
  return picture?.title ?? fallback;
}

/** Album title for a drawing, or a neutral label when the album is gone. */
export function albumTitleOf(albumId: string | null): string {
  if (!albumId) return "Мои рисунки";
  return findAlbum(albumId)?.title ?? "Мои рисунки";
}
