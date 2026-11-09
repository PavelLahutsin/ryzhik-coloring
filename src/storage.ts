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
  /** Parent switch "Только заливка": S4 shows the bucket and the palette only. */
  fillOnly: boolean;
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
  /** Gallery entry this draft belongs to, so reopening keeps writing there. */
  drawingId?: string;
  /** Set by draft() when the copy came from the last-gasp localStorage save. */
  recovered?: boolean;
};

export type Drawing = {
  id: string;
  pictureId: string;
  albumId: string | null;
  title: string;
  /** Flattened PNG as a data URL, at most 1280px on the long side. */
  image: string;
  /** Paint layer only (PNG data URL), so the drawing can be continued.
   *  Missing on entries saved before this field existed. */
  paint?: string;
  createdAt: number;
  updatedAt?: number;
  /** A star was already given for this drawing; "Готово" again gives none. */
  starred?: boolean;
};

/** Gallery index row: everything but the heavy images. */
type DrawingMeta = Omit<Drawing, "image" | "paint">;

const SETTINGS_KEY = "settings";
const PROGRESS_KEY = "progress";
/** Legacy: every drawing in one array. Read once and split, see `migrate`. */
const DRAWINGS_KEY = "drawings";
/** Newest-first list of gallery metadata. */
const DRAWING_INDEX_KEY = "drawings:index";
/** One record per drawing: a save rewrites one picture, not the whole album. */
const DRAWING_PREFIX = "drawing:";
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
  fillOnly: false,
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
    const saved = await idb.get<Draft>(DRAFT_PREFIX + pictureId);
    const pending = readPending(pictureId);
    if (!pending || (saved && saved.updatedAt > pending.updatedAt)) return saved;
    if (!pending.paint) {
      // The sheet was wiped and the app closed before the async write finished.
      await idb.remove(DRAFT_PREFIX + pictureId);
      dropPending(pictureId, pending.updatedAt);
      return null;
    }
    return {
      pictureId,
      paint: pending.paint,
      updatedAt: pending.updatedAt,
      drawingId: pending.drawingId,
      recovered: true,
    };
  },

  async clearDraft(pictureId: string): Promise<void> {
    const at = Date.now();
    await idb.remove(DRAFT_PREFIX + pictureId);
    dropPending(pictureId, at);
  },

  async saveDraft(pictureId: string, paint: string, drawingId?: string): Promise<void> {
    const draft: Draft = { pictureId, paint, updatedAt: Date.now(), drawingId };
    const ok = await idb.set(DRAFT_PREFIX + pictureId, draft);
    if (ok) dropPending(pictureId, draft.updatedAt);
  },

  /**
   * Last-gasp copy for a page that is being closed. localStorage is written
   * synchronously, IndexedDB is not, and a closing page may never finish an
   * async write. draft() picks this copy up on the next start. An empty paint
   * means the sheet was wiped.
   */
  saveDraftSync(pictureId: string, paint: string, drawingId?: string): void {
    try {
      const pending: PendingDraft = { paint, drawingId, updatedAt: Date.now() };
      localStorage.setItem(PENDING_PREFIX + pictureId, JSON.stringify(pending));
    } catch {
      /* Quota: the normal IndexedDB save still runs. */
    }
  },

  /** Newest first. Older entries are kept; the limit is enforced on save. */
  async drawings(): Promise<Drawing[]> {
    const index = await drawingIndex();
    const list = await Promise.all(index.map((meta) => idb.get<Drawing>(DRAWING_PREFIX + meta.id)));
    return list.filter((item): item is Drawing => Boolean(item && item.image));
  },

  async addDrawing(drawing: Drawing): Promise<Drawing[]> {
    await this.upsertDrawing(drawing);
    return this.drawings();
  },

  /** Inserts or replaces by id. S4 writes the same id for the whole session,
   *  so autosave and a second "Готово" update one gallery entry. */
  async upsertDrawing(drawing: Drawing): Promise<void> {
    const saved: Drawing = { ...drawing, updatedAt: Date.now() };
    const ok = await idb.set(DRAWING_PREFIX + saved.id, saved);
    if (!ok) return;
    const index = (await drawingIndex()).filter((item) => item.id !== saved.id);
    index.unshift(metaOf(saved));
    const kept = index.slice(0, DRAWING_LIMIT);
    for (const dropped of index.slice(DRAWING_LIMIT)) await idb.remove(DRAWING_PREFIX + dropped.id);
    await idb.set(DRAWING_INDEX_KEY, kept);
  },

  async findDrawing(id: string): Promise<Drawing | null> {
    await drawingIndex();
    return idb.get<Drawing>(DRAWING_PREFIX + id);
  },

  async removeDrawing(id: string): Promise<void> {
    const index = (await drawingIndex()).filter((item) => item.id !== id);
    await idb.set(DRAWING_INDEX_KEY, index);
    await idb.remove(DRAWING_PREFIX + id);
  },

  /** Adult-only action, always behind the parental gate. */
  async resetProgress(): Promise<void> {
    await platform.storage.remove(PROGRESS_KEY);
    for (const meta of await drawingIndex()) {
      await idb.remove(DRAWING_PREFIX + meta.id);
      await idb.remove(DRAFT_PREFIX + meta.pictureId);
    }
    await idb.remove(DRAWING_INDEX_KEY);
    await idb.remove(DRAWINGS_KEY);
    clearAllPending();
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

function metaOf(drawing: Drawing): DrawingMeta {
  const { image: _image, paint: _paint, ...meta } = drawing;
  return meta;
}

let migration: Promise<void> | null = null;

/** Moves the old single-array gallery into per-drawing records, once. */
function migrate(): Promise<void> {
  migration ??= (async () => {
    const legacy = await idb.get<Drawing[]>(DRAWINGS_KEY);
    if (!legacy || legacy.length === 0) return;
    const index = (await idb.get<DrawingMeta[]>(DRAWING_INDEX_KEY)) ?? [];
    const known = new Set(index.map((item) => item.id));
    for (const drawing of legacy) {
      if (!drawing?.id || known.has(drawing.id)) continue;
      const ok = await idb.set(DRAWING_PREFIX + drawing.id, drawing);
      if (ok) index.push(metaOf(drawing));
    }
    index.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
    if (await idb.set(DRAWING_INDEX_KEY, index.slice(0, DRAWING_LIMIT))) {
      await idb.remove(DRAWINGS_KEY);
    }
  })();
  return migration;
}

async function drawingIndex(): Promise<DrawingMeta[]> {
  await migrate();
  const index = (await idb.get<DrawingMeta[]>(DRAWING_INDEX_KEY)) ?? [];
  return [...index].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
}

const PENDING_PREFIX = "ryzhik:pending:";

type PendingDraft = { paint: string; drawingId?: string; updatedAt: number };

function readPending(pictureId: string): PendingDraft | null {
  try {
    const raw = localStorage.getItem(PENDING_PREFIX + pictureId);
    return raw ? (JSON.parse(raw) as PendingDraft) : null;
  } catch {
    return null;
  }
}

/** Removes the last-gasp copy once a normal save at least as new has landed. */
function dropPending(pictureId: string, savedAt: number): void {
  try {
    const pending = readPending(pictureId);
    if (pending && pending.updatedAt <= savedAt) localStorage.removeItem(PENDING_PREFIX + pictureId);
  } catch {
    /* ignore */
  }
}

function clearAllPending(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PENDING_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}
