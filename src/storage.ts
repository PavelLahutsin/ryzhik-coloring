import { findAlbum, type PictureEntry } from "./data/albums";
import { platform } from "./platform";
import { fitsLocalBudget, idb } from "./platform/idb";

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
  /** Lullaby sleep timer in minutes, one of LULLABY_MINUTES. */
  lullabyMinutes: LullabyMinutes;
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

export const LULLABY_MINUTES = [10, 20, 30] as const;
export type LullabyMinutes = (typeof LULLABY_MINUTES)[number];

export const DEFAULT_SETTINGS: Settings = {
  magnet: true,
  magnetLocked: false,
  brushSize: 16,
  music: true,
  sounds: true,
  voice: true,
  analytics: false,
  fillOnly: false,
  lullabyMinutes: 20,
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
      const key = PENDING_PREFIX + pictureId;
      const pending: PendingDraft = { paint, drawingId, updatedAt: Date.now() };
      const payload = JSON.stringify(pending);
      // A too-big copy is skipped. IndexedDB is still written by the async save,
      // and a failed setItem must not throw into pagehide.
      if (!fitsLocalBudget(key, payload)) return;
      localStorage.setItem(key, payload);
    } catch {
      /* Quota: the normal IndexedDB save still runs. */
    }
  },

  /** Newest first. Older entries are kept; the limit is enforced on save. */
  async drawings(): Promise<Drawing[]> {
    const index = await drawingIndex();
    const legacy = await legacyById();
    const list = await Promise.all(
      index.map(async (meta) => {
        const stored = await idb.get<Drawing>(DRAWING_PREFIX + meta.id);
        if (stored?.image) return stored;
        return legacy.get(meta.id) ?? null;
      }),
    );
    return list.filter((item): item is Drawing => Boolean(item && item.image));
  },

  async addDrawing(drawing: Drawing): Promise<Drawing[]> {
    await this.upsertDrawing(drawing);
    return this.drawings();
  },

  /** Inserts or replaces by id. S4 writes the same id for the whole session,
   *  so autosave and a second "Готово" update one gallery entry. */
  async upsertDrawing(drawing: Drawing): Promise<boolean> {
    const saved: Drawing = { ...drawing, updatedAt: Date.now() };
    const ok = await idb.set(DRAWING_PREFIX + saved.id, saved);
    if (!ok) return false;
    const index = (await drawingIndex()).filter((item) => item.id !== saved.id);
    index.unshift(metaOf(saved));
    const kept = index.slice(0, DRAWING_LIMIT);
    const dropped = index.slice(DRAWING_LIMIT);
    const indexed = await idb.set(DRAWING_INDEX_KEY, kept);
    if (!indexed) return false;
    for (const item of dropped) await idb.remove(DRAWING_PREFIX + item.id);
    return true;
  },

  async findDrawing(id: string): Promise<Drawing | null> {
    await drawingIndex();
    const stored = await idb.get<Drawing>(DRAWING_PREFIX + id);
    if (stored?.image) return stored;
    return (await legacyById()).get(id) ?? null;
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

/**
 * Moves the old single-array gallery into per-drawing records, once.
 * The old array is removed only after every kept record and the new index
 * are stored. A failure leaves the old array in place and the next read tries
 * again, so a full quota cannot delete the gallery.
 */
function migrate(): Promise<void> {
  if (migration) return migration;
  migration = migrateOnce().then(
    () => undefined,
    () => {
      migration = null;
    },
  );
  return migration;
}

async function migrateOnce(): Promise<void> {
  const legacy = await idb.get<Drawing[]>(DRAWINGS_KEY);
  if (!Array.isArray(legacy) || legacy.length === 0) return;
  const index = (await idb.get<DrawingMeta[]>(DRAWING_INDEX_KEY)) ?? [];
  const known = new Set(index.map((item) => item.id));
  const incoming = legacy.filter(
    (drawing): drawing is Drawing =>
      Boolean(drawing && typeof drawing.id === "string" && drawing.image && !known.has(drawing.id)),
  );
  const merged = [...index, ...incoming.map((drawing) => metaOf(drawing))];
  merged.sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0));
  const kept = merged.slice(0, DRAWING_LIMIT);
  const keptIds = new Set(kept.map((item) => item.id));
  for (const drawing of incoming) {
    if (!keptIds.has(drawing.id)) continue;
    const ok = await idb.set(DRAWING_PREFIX + drawing.id, drawing);
    if (!ok) throw new Error("gallery-migration");
  }
  if (!(await idb.set(DRAWING_INDEX_KEY, kept))) throw new Error("gallery-migration");
  await idb.remove(DRAWINGS_KEY);
}

async function legacyById(): Promise<Map<string, Drawing>> {
  const legacy = await idb.get<Drawing[]>(DRAWINGS_KEY);
  const map = new Map<string, Drawing>();
  if (!Array.isArray(legacy)) return map;
  for (const drawing of legacy) {
    if (drawing?.id && drawing.image) map.set(drawing.id, drawing);
  }
  return map;
}

async function drawingIndex(): Promise<DrawingMeta[]> {
  await migrate();
  const index = (await idb.get<DrawingMeta[]>(DRAWING_INDEX_KEY)) ?? [];
  const byId = new Map<string, DrawingMeta>();
  for (const item of index) {
    if (item?.id) byId.set(item.id, item);
  }
  // While the old array is still here, a failed copy must not hide those pictures.
  for (const drawing of (await legacyById()).values()) {
    if (!byId.has(drawing.id)) byId.set(drawing.id, metaOf(drawing));
  }
  return [...byId.values()].sort(
    (a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0),
  );
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
