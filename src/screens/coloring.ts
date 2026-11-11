import { albumOfPicture, artFor, findPicture } from "../data/albums";
import { ColoringBook, type Tool } from "../engine";
import { platform } from "../platform";
import { href, navigate } from "../router";
import { sound } from "../sound";
import { BRUSH_SIZES, store, type Settings } from "../storage";
import { el } from "../ui/dom";
import { holdButton } from "../ui/hold";
import { icon, type IconName } from "../ui/icons";
import { topbar } from "../ui/topbar";

/**
 * S4. The colours and the tool order are fixed by docs/design.md §4.2.
 * Colouring logic itself lives in engine.ts and is untouched here: this screen
 * only wires the chrome around it.
 */
type ColorEntry = { name: string; hex: string };

/**
 * Eight big colours that are always on screen. Orange and green are sampled
 * from src/assets/ryzhik/ryzhik-wave.webp, yellow is --yellow (the star colour)
 * from docs/design.md.
 */
const MAIN_COLORS: ColorEntry[] = [
  { name: "Красный", hex: "#ff4b4b" },
  { name: "Рыжий", hex: "#f08c35" },
  { name: "Жёлтый", hex: "#ffc94a" },
  { name: "Зелёный", hex: "#5a814b" },
  { name: "Голубой", hex: "#7ad7ff" },
  { name: "Синий", hex: "#4c8dff" },
  { name: "Розовый", hex: "#ff7eb6" },
  { name: "Коричневый", hex: "#a56a3c" },
];

/** The rest of the expanded palette: with the eight above it is 24 colours. */
const MORE_COLORS: ColorEntry[] = [
  { name: "Тёмно-красный", hex: "#d62828" },
  { name: "Персиковый", hex: "#ffb07a" },
  { name: "Бежевый", hex: "#f3d2b3" },
  { name: "Светло-жёлтый", hex: "#ffe08a" },
  { name: "Салатовый", hex: "#c6e04a" },
  { name: "Ярко-зелёный", hex: "#3cbf4a" },
  { name: "Тёмно-зелёный", hex: "#1f8a3b" },
  { name: "Бирюзовый", hex: "#3ec6c6" },
  { name: "Тёмно-синий", hex: "#2a5bd7" },
  { name: "Сиреневый", hex: "#c9a6ff" },
  { name: "Фиолетовый", hex: "#a878ff" },
  { name: "Светло-розовый", hex: "#ffb3d4" },
  { name: "Светло-коричневый", hex: "#c4844a" },
  { name: "Серый", hex: "#b9b1a8" },
  { name: "Белый", hex: "#ffffff" },
  { name: "Чёрный", hex: "#2a211c" },
];

const ALL_COLORS: ColorEntry[] = [...MAIN_COLORS, ...MORE_COLORS];

/** A save is scheduled this long after the last action, and never mid-stroke. */
const SAVE_DELAY_MS = 500;

type KidTool = Extract<Tool, "fill" | "marker" | "pencil" | "crayon" | "eraser">;

const TOOL_HINTS: Record<KidTool, string> = {
  fill: "Нажми на область, чтобы закрасить",
  marker: "Фломастер рисует гладко",
  pencil: "Карандаш рисует тонко",
  crayon: "Мелки оставляют следы, как на бумаге",
  eraser: "Ластик стирает краску",
};

const TOOL_ITEMS: { kind: KidTool; label: string; glyph: IconName }[] = [
  { kind: "fill", label: "Заливка", glyph: "bucket" },
  { kind: "marker", label: "Фломастер", glyph: "marker" },
  { kind: "pencil", label: "Карандаш", glyph: "pencil" },
  { kind: "crayon", label: "Мелки", glyph: "crayon" },
  { kind: "eraser", label: "Ластик", glyph: "eraser" },
];

const SIZE_LABELS: Record<(typeof BRUSH_SIZES)[number], string> = {
  8: "Маленький",
  16: "Средний",
  26: "Большой",
};

export function mountPicture(
  root: HTMLElement,
  pictureId: string,
  drawingId?: string,
): () => void {
  const picture = findPicture(albumOfPicture(pictureId)?.id ?? "", pictureId);
  const album = albumOfPicture(pictureId);
  const art = artFor(pictureId);

  const title = picture?.title ?? "Раскраска";
  const albumId = album?.id ?? "";

  // --- chrome ---------------------------------------------------------------
  const undoBtn = el(
    "button",
    { class: "topbar__btn", attrs: { type: "button", "aria-label": "Отменить" } },
    [icon("undo", 26)],
  );
  const redoBtn = el(
    "button",
    { class: "topbar__btn", attrs: { type: "button", "aria-label": "Повторить" } },
    [icon("redo", 26)],
  );
  const doneBtn = el(
    "button",
    { class: "btn btn--done", attrs: { type: "button", "aria-label": "Готово" } },
    [icon("check", 26), el("span", { class: "btn__label", text: "Готово" })],
  );

  const canvas = el("canvas", { class: "sheet", attrs: { "aria-label": "Лист раскраски" } });
  const stage = el("div", { class: "paint__stage" }, [canvas]);
  const loading = el("p", { class: "paint__loading", text: "Открываем картинку…" });

  const magnetLabel = el("span", { class: "magnet__label", text: "В линиях" });
  const magnetBtn = el(
    "button",
    {
      class: "magnet is-on",
      attrs: { type: "button", "aria-pressed": "true", "aria-label": "Краска не выходит за линии" },
    },
    [icon("magnet", 26), magnetLabel],
  );

  const toolsRow = el("div", { class: "tools", attrs: { role: "group", "aria-label": "Инструменты" } });
  const sizeRow = el("div", { class: "sizes", attrs: { role: "group", "aria-label": "Размер" } });
  const paletteRow = el("div", { class: "palette", attrs: { role: "listbox", "aria-label": "Цвета" } });
  const hint = el("p", { class: "paint__hint", text: TOOL_HINTS.fill });
  const toast = el("p", { class: "toast", attrs: { role: "status", hidden: true } });
  const frame = el("div", { class: "paint__frame" }, [stage, loading, toast]);

  const zoomBtn = el(
    "button",
    {
      class: "zoomreset",
      attrs: { type: "button", hidden: true, "aria-label": "Вернуть как было" },
      on: {
        click: () => {
          book.resetZoom();
          sound.play("tap");
        },
      },
    },
    [icon("fit", 30)],
  );

  const paint = el("div", { class: "paint" }, [
    topbar({
      title,
      onBack: () => leave(`/album/${albumId}`),
      onHome: () => leave("/menu"),
      trailing: [undoBtn, redoBtn, doneBtn],
      class: "topbar--paint",
    }),
    el("div", { class: "paint__canvas" }, [magnetBtn, zoomBtn, frame]),
    el("div", { class: "dock" }, [
      toolsRow,
      sizeRow,
      paletteRow,
      hint,
    ]),
  ]);
  root.append(paint);

  // --- state ----------------------------------------------------------------
  const book = new ColoringBook(canvas, stage);
  book.onSound = (event) => {
    sound.play(event);
    if (event === "fill") sound.noteFill();
  };
  let settings: Settings | undefined;
  let tool: KidTool = "fill";
  let color = MAIN_COLORS[1].hex;
  let brushSize: (typeof BRUSH_SIZES)[number] = 16;
  let disposed = false;
  let saving = false;
  /** Id of the gallery entry this session writes to, so repeats update it. */
  let sessionDrawingId: string | null = null;
  let morePanel: HTMLElement | null = null;
  let fillOnly = false;

  let toastTimer = 0;
  const showToast = (text: string): void => {
    toast.hidden = false;
    toast.textContent = text;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 1800);
  };

  const setMagnet = (on: boolean): void => {
    book.setClip(on);
    magnetBtn.classList.toggle("is-on", on);
    magnetBtn.setAttribute("aria-pressed", String(on));
    magnetBtn.setAttribute(
      "aria-label",
      on ? "Краска не выходит за линии" : "Можно рисовать поверх линий",
    );
    magnetLabel.textContent = on ? "В линиях" : "Свободно";
    magnetBtn.replaceChildren(icon(on ? "magnet" : "magnetOff", 26), magnetLabel);
    if (settings?.magnetLocked) {
      magnetBtn.append(el("span", { class: "magnet__lock" }, [icon("lock", 14)]));
    }
  };

  const syncHistory = (): void => {
    undoBtn.disabled = !book.canUndo;
    redoBtn.disabled = !book.canRedo;
  };

  const applySize = (size: (typeof BRUSH_SIZES)[number], persist: boolean): void => {
    brushSize = size;
    book.setSize(size);
    if (persist) {
      void store.saveSettings({ brushSize: size });
      if (settings) settings.brushSize = size;
    }
    renderSizes();
  };

  const selectTool = (next: KidTool): void => {
    if (tool === next) return;
    tool = next;
    book.setTool(next);
    if (next !== "fill") book.setSize(brushSize);
    hint.textContent = TOOL_HINTS[next];
    sound.play("tool");
    renderTools();
  };

  const clearButton = (): HTMLElement =>
    holdButton({
      label: "Очистить",
      icon: icon("clear", 28),
      duration: 1200,
      onShort: () => showToast("Удерживай, чтобы очистить"),
      onHold: () => {
        if (!book.hasPaint()) {
          hint.textContent = "Пока нечего стирать";
          sound.play("miss");
          return;
        }
        book.clear();
        sound.play("clear");
        hint.textContent = "Чистый лист";
        window.setTimeout(() => {
          if (!disposed) hint.textContent = TOOL_HINTS[tool];
        }, 2200);
      },
    });

  const renderSizes = (): void => {
    sizeRow.replaceChildren();
    sizeRow.hidden = fillOnly;
    if (fillOnly) return;
    for (const size of BRUSH_SIZES) {
      const visual = Math.max(10, Math.round(size * 0.95));
      const dot = el("span", { class: "sizes__dot", style: { width: `${visual}px`, height: `${visual}px` } });
      const btn = el(
        "button",
        {
          class: "sizes__btn",
          attrs: {
            type: "button",
            "aria-label": SIZE_LABELS[size],
            "aria-pressed": String(brushSize === size),
          },
          on: {
            click: () => {
              if (brushSize === size) return;
              applySize(size, true);
              sound.play("tool");
            },
          },
        },
        [dot],
      );
      sizeRow.append(btn);
    }
    const clear = clearButton();
    clear.classList.add("sizes__clear");
    sizeRow.append(clear);
  };

  const renderTools = (): void => {
    toolsRow.replaceChildren();
    toolsRow.classList.toggle("tools--single", fillOnly);
    const items = fillOnly ? TOOL_ITEMS.slice(0, 1) : TOOL_ITEMS;
    for (const item of items) {
      const node = el(
        "button",
        {
          class: `tool${tool === item.kind ? " is-active" : ""}`,
          attrs: { type: "button", "aria-pressed": String(tool === item.kind), "aria-label": item.label },
          dataset: { tool: item.kind },
          on: { click: () => selectTool(item.kind) },
        },
        [icon(item.glyph, 28), el("span", { class: "tool__label", text: item.label })],
      );
      toolsRow.append(node);
    }
  };

  const lightSwatch = (hex: string): boolean => {
    const n = Number.parseInt(hex.slice(1), 16);
    const luma = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return luma > 0.62;
  };

  const closeMore = (): void => {
    morePanel?.remove();
    morePanel = null;
  };

  const pickColor = (entry: ColorEntry): void => {
    color = entry.hex;
    book.setColor(color);
    sound.noteColor();
    sound.play("color");
    hint.textContent = entry.name;
    closeMore();
    renderPalette();
  };

  const swatch = (entry: ColorEntry): HTMLButtonElement => {
    const selected = entry.hex === color;
    const light = lightSwatch(entry.hex);
    return el(
      "button",
      {
        class: `swatch${light ? " swatch--light" : ""}${selected ? " is-active" : ""}`,
        attrs: {
          type: "button",
          role: "option",
          "aria-label": entry.name,
          "aria-selected": String(selected),
        },
        dataset: { color: entry.hex },
        style: { background: entry.hex, color: light ? "#2a211c" : "#ffffff" },
        on: { click: () => pickColor(entry) },
      },
      [el("span", { class: "swatch__check", attrs: { "aria-hidden": "true" } }, [icon("check", 30)])],
    );
  };

  /** "ещё": a sheet with all 24 colours. A colour tap or the cross closes it. */
  const openMore = (): void => {
    if (morePanel) {
      closeMore();
      return;
    }
    sound.play("tap");
    const close = el(
      "button",
      {
        class: "topbar__btn more__close",
        attrs: { type: "button", "aria-label": "Закрыть" },
        on: { click: closeMore },
      },
      [icon("close", 30)],
    );
    const grid = el(
      "div",
      { class: "more__grid", attrs: { role: "listbox", "aria-label": "Все цвета" } },
      ALL_COLORS.map((entry) => swatch(entry)),
    );
    const overlay: HTMLElement = el(
      "div",
      {
        class: "more",
        on: {
          click: (event) => {
            if (event.target === overlay) closeMore();
          },
        },
      },
      [el("div", { class: "more__panel" }, [close, grid])],
    );
    paint.append(overlay);
    morePanel = overlay;
  };

  const renderPalette = (): void => {
    // A colour picked from the sheet is shown on the "ещё" button itself, so the
    // current colour is always visible and marked.
    const extra = !MAIN_COLORS.some((entry) => entry.hex === color);
    const more = el(
      "button",
      {
        class: `swatch swatch--more${extra ? " is-active" : ""}`,
        attrs: { type: "button", "aria-label": "Ещё цвета", "aria-haspopup": "dialog" },
        on: { click: openMore },
      },
      [
        el("span", {
          class: "more__core",
          text: "ещё",
          style: extra ? { background: color, color: lightSwatch(color) ? "#2a211c" : "#ffffff" } : {},
        }),
      ],
    );
    paletteRow.replaceChildren(...MAIN_COLORS.map((entry) => swatch(entry)), more);
  };

  // --- persistence ----------------------------------------------------------
  let loaded = false;
  let dirty = false;
  let saveTimer = 0;
  let saveChain: Promise<void> = Promise.resolve();
  /** Async writes that have started and not finished yet. */
  let pendingWrites = 0;
  /** The draft came from the last-gasp copy: write it to the gallery too. */
  let recovered = false;
  let sessionCreatedAt = 0;
  let sessionStarred = false;

  /**
   * Writes the draft and the album progress. The gallery entry is created only
   * in `finish` («Готово»): an unfinished sheet must not fill «Мои рисунки».
   * `force` commits a stroke in progress; the debounced call waits for the
   * finger to lift instead.
   */
  const persist = (force = false): Promise<void> => {
    window.clearTimeout(saveTimer);
    if (!loaded) return saveChain;
    if (!force && book.busy) {
      saveTimer = window.setTimeout(() => void persist(), SAVE_DELAY_MS);
      return saveChain;
    }
    book.flush();
    window.clearTimeout(saveTimer);
    if (!dirty) return saveChain;
    dirty = false;
    const paintUrl = book.snapshot();
    if (!paintUrl) {
      // The sheet was wiped: nothing to continue. A finished gallery entry stays.
      pendingWrites += 1;
      saveChain = saveChain
        .then(() => store.clearDraft(pictureId))
        .catch(() => undefined)
        .then(() => {
          pendingWrites -= 1;
        });
      return saveChain;
    }
    const id = sessionDrawingId ?? `${pictureId}-${Date.now()}`;
    sessionDrawingId = id;
    if (!sessionCreatedAt) sessionCreatedAt = Date.now();
    const ratio = book.progress().ratio;
    pendingWrites += 1;
    saveChain = saveChain
      .then(async () => {
        await store.saveDraft(pictureId, paintUrl, id);
        const state = await store.pictureState(pictureId);
        await store.savePictureState(pictureId, {
          ratio,
          status: state?.status === "done" ? "done" : "draft",
        });
      })
      .catch(() => undefined)
      .then(() => {
        pendingWrites -= 1;
      });
    return saveChain;
  };

  /**
   * Synchronous safety copy for a page that is closing. IndexedDB writes are
   * async and may not finish when the app is swiped away right after a tap.
   * The copy is a small PNG: a full-resolution sheet does not fit in the
   * ~5 MB localStorage quota next to settings and progress.
   */
  const emergencySave = (): void => {
    if (!loaded || (!dirty && pendingWrites === 0)) return;
    book.flush();
    const paintUrl = book.snapshot(640) ?? "";
    if (paintUrl) {
      sessionDrawingId ??= `${pictureId}-${Date.now()}`;
      if (!sessionCreatedAt) sessionCreatedAt = Date.now();
    }
    store.saveDraftSync(pictureId, paintUrl, sessionDrawingId ?? undefined);
  };

  const scheduleSave = (): void => {
    dirty = true;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void persist(), SAVE_DELAY_MS);
  };

  const leave = (path: string): void => {
    if (path === "/menu") sound.goodbye();
    void persist(true);
    navigate(path);
  };

  const finish = async (): Promise<void> => {
    if (saving || !loaded) return;
    saving = true;
    doneBtn.disabled = true;
    try {
      closeMore();
      // "Готово" is always allowed and always cheerful: any amount of paint gets
      // the same reward screen. The star is given once per drawing, and only
      // after that drawing is actually in the gallery.
      const painted = book.hasPaint();
      if (painted) dirty = true;
      await persist(true);
      let newStar = false;
      let savedId = "-";
      if (painted) {
        const id = sessionDrawingId ?? `${pictureId}-${Date.now()}`;
        sessionDrawingId = id;
        if (!sessionCreatedAt) sessionCreatedAt = Date.now();
        const image = await book.exportDataUrl(1280);
        const paintUrl = book.snapshot();
        if (image && paintUrl) {
          const willStar = !sessionStarred;
          const wrote = await store.upsertDrawing({
            id,
            pictureId,
            albumId: albumId || null,
            title,
            image,
            paint: paintUrl,
            createdAt: sessionCreatedAt,
            starred: sessionStarred || willStar,
          });
          if (wrote) {
            savedId = id;
            if (willStar) {
              sessionStarred = true;
              newStar = true;
              await store.awardStar();
            }
            await store.savePictureState(pictureId, { ratio: book.progress().ratio, status: "done" });
            await store.clearDraft(pictureId);
          }
        }
      }
      platform.haptics("success");
      disposed = true;
      navigate(`/reward/${pictureId}/${savedId}${newStar ? "/star" : ""}`);
    } finally {
      saving = false;
      doneBtn.disabled = false;
    }
  };

  // --- wiring ---------------------------------------------------------------
  book.onHistory = syncHistory;
  // Every finished fill, stroke, undo or clear schedules a save, so nothing the
  // child did is lost if the app is closed right after.
  book.onPaint = () => {
    if (loaded && !disposed) scheduleSave();
  };
  book.onZoom = (zoomed) => {
    zoomBtn.hidden = !zoomed;
  };

  undoBtn.addEventListener("click", () => {
    book.undo();
    sound.play("undo");
    sound.noteUndo();
  });
  redoBtn.addEventListener("click", () => {
    book.redo();
    sound.play("tool");
  });
  doneBtn.addEventListener("click", () => void finish());

  magnetBtn.addEventListener("click", () => {
      if (settings?.magnetLocked) {
      sound.play("locked");
      hint.textContent = "Магнит заперт взрослым";
      showToast("Взрослый включил «в линиях»");
      return;
    }
    const next = !magnetBtn.classList.contains("is-on");
    setMagnet(next);
    void store.saveSettings({ magnet: next });
    sound.play("magnet");
    platform.haptics("light");
    hint.textContent = next ? "Краска не выходит за линии" : "Можно рисовать поверх линий";
  });

  const canvasBox = paint.querySelector<HTMLElement>(".paint__canvas")!;
  canvasBox.addEventListener("pointerdown", () => sound.unlock(), { once: true });

  const onHide = (): void => {
    if (document.visibilityState !== "hidden") return;
    emergencySave();
    void persist(true);
  };
  const onPageHide = (): void => {
    emergencySave();
    void persist(true);
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onPageHide);
  // Android does not always fire visibilitychange when the app is backgrounded.
  window.addEventListener("ryzhik:background", onPageHide);
  window.addEventListener("ryzhik:leave", onPageHide);

  renderTools();
  renderSizes();
  renderPalette();
  syncHistory();

  void (async () => {
    settings = await store.settings();
    const savedSize = BRUSH_SIZES.includes(settings.brushSize as (typeof BRUSH_SIZES)[number])
      ? (settings.brushSize as (typeof BRUSH_SIZES)[number])
      : 16;
    setMagnet(settings.magnet);
    book.setColor(color);
    book.setTool("fill");
    book.setSize(savedSize);
    fillOnly = settings.fillOnly;
    magnetBtn.hidden = fillOnly;
    applySize(savedSize, false);
    renderTools();

    if (!art) {
      loading.textContent = "Картинка не найдена";
      return;
    }
    try {
      await book.load(art.svg, art.png ?? art.svg);
      loading.remove();
      const wanted = drawingId ? await store.findDrawing(drawingId) : null;
      if (wanted) {
        sessionDrawingId = wanted.id;
        sessionCreatedAt = wanted.createdAt;
        sessionStarred = wanted.starred === true;
        const newer = await store.draft(pictureId);
        const draftIsNewer =
          Boolean(newer?.paint) &&
          newer?.drawingId === wanted.id &&
          (newer?.updatedAt ?? 0) >= (wanted.updatedAt ?? wanted.createdAt);
        if (draftIsNewer && newer?.paint) {
          await book.restore(newer.paint);
          recovered = newer.recovered === true;
        } else if (wanted.paint) await book.restore(wanted.paint);
        else await book.restoreFlattened(wanted.image);
      } else {
        const draft = await store.draft(pictureId);
        if (draft?.paint) {
          const owner = draft.drawingId ? await store.findDrawing(draft.drawingId) : null;
          sessionDrawingId = owner ? owner.id : null;
          sessionCreatedAt = owner?.createdAt ?? 0;
          sessionStarred = owner?.starred === true;
          await book.restore(draft.paint);
          recovered = draft.recovered === true;
        }
      }
      loaded = true;
      dirty = false;
      sound.enterColoring(book.hasPaint());
      syncHistory();
      if (recovered) scheduleSave();
    } catch {
      loading.textContent = "Не получилось открыть рисунок. Обновите страницу.";
      return;
    }
  })();

  // Keyboard shortcuts are for the adult testing on a desktop browser.
  const onKey = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === "z" && event.shiftKey) {
      event.preventDefault();
      book.redo();
    } else if (key === "z") {
      event.preventDefault();
      book.undo();
    } else if (key === "y") {
      event.preventDefault();
      book.redo();
    }
  };
  window.addEventListener("keydown", onKey);

  return () => {
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("ryzhik:background", onPageHide);
    window.removeEventListener("ryzhik:leave", onPageHide);
    window.removeEventListener("keydown", onKey);
    window.clearTimeout(toastTimer);
    closeMore();
    book.flush();
    disposed = true;
    window.clearTimeout(saveTimer);
    book.dispose();
    void persist(true);
  };
}

/** Kept for the router: S4 needs a picture id and nothing else. */
export function picturePath(pictureId: string): string {
  return href(`/picture/${pictureId}`);
}
