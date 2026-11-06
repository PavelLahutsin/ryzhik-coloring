import { albumOfPicture, artFor, findPicture } from "../data/albums";
import { ColoringBook, type Tool } from "../engine";
import { platform } from "../platform";
import { href, navigate } from "../router";
import { sound } from "../sound";
import { BRUSH_SIZES, store, type Settings } from "../storage";
import { el } from "../ui/dom";
import { holdButton } from "../ui/hold";
import { icon } from "../ui/icons";
import { topbar } from "../ui/topbar";

/**
 * S4. The colours and the tool order are fixed by docs/design.md §4.2.
 * Colouring logic itself lives in engine.ts and is untouched here: this screen
 * only wires the chrome around it.
 */
const PALETTE = [
  { name: "Красный", hex: "#f04444" },
  { name: "Алый", hex: "#ff6b57" },
  { name: "Оранжевый", hex: "#ff9138" },
  { name: "Персиковый", hex: "#ffc08c" },
  { name: "Бежевый", hex: "#e8c89b" },
  { name: "Цвет кожи", hex: "#f2b991" },
  { name: "Жёлтый", hex: "#ffd447" },
  { name: "Золотистый", hex: "#e9a928" },
  { name: "Лимонный", hex: "#f3ef75" },
  { name: "Салатовый", hex: "#a8d957" },
  { name: "Зелёный", hex: "#53bf62" },
  { name: "Тёмно-зелёный", hex: "#287c4e" },
  { name: "Бирюзовый", hex: "#36bcae" },
  { name: "Голубой", hex: "#77d5f2" },
  { name: "Небесно-голубой", hex: "#a6dcff" },
  { name: "Синий", hex: "#4389e8" },
  { name: "Тёмно-синий", hex: "#354f9e" },
  { name: "Сиреневый", hex: "#c6a0e8" },
  { name: "Фиолетовый", hex: "#8b63c7" },
  { name: "Розовый", hex: "#f278ae" },
  { name: "Светло-розовый", hex: "#ffc0d7" },
  { name: "Бордовый", hex: "#a83e59" },
  { name: "Светло-коричневый", hex: "#bd8b62" },
  { name: "Коричневый", hex: "#8b5b3e" },
  { name: "Тёмно-коричневый", hex: "#563a31" },
  { name: "Серый", hex: "#9aa1a8" },
  { name: "Белый", hex: "#ffffff" },
  { name: "Чёрный", hex: "#252525" },
];

const DONE_RATIO = 0.85;
const AUTOSAVE_MS = 3000;

type KidTool = Extract<Tool, "fill" | "brush" | "eraser">;

const TOOL_HINTS: Record<KidTool, string> = {
  fill: "Нажми на область, чтобы закрасить",
  brush: "Веди пальцем — получится линия",
  eraser: "Ластик стирает краску",
};

export function mountPicture(root: HTMLElement, pictureId: string): () => void {
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

  const magnetBtn = el(
    "button",
    { class: "magnet", attrs: { type: "button", "aria-pressed": "true", "aria-label": "Не выходить за линии" } },
    [icon("magnet", 26)],
  );

  const toolsRow = el("div", { class: "tools" });
  const paletteRow = el("div", { class: "palette", attrs: { role: "listbox", "aria-label": "Цвета" } });
  const hint = el("p", { class: "paint__hint", text: TOOL_HINTS.fill });

  const paint = el("div", { class: "paint" }, [
    topbar({
      title,
      onBack: () => leave(`/album/${albumId}`),
      onHome: () => leave("/menu"),
      trailing: [undoBtn, redoBtn, doneBtn],
      class: "topbar--paint",
    }),
    el("div", { class: "paint__canvas" }, [magnetBtn, stage, loading]),
    el("div", { class: "dock" }, [toolsRow, paletteRow, hint]),
  ]);
  root.append(paint);

  // --- state ----------------------------------------------------------------
  const book = new ColoringBook(canvas, stage);
  let settings: Settings;
  let tool: KidTool = "fill";
  let color = PALETTE[1].hex;
  let sizes: Record<"brush" | "eraser", number> = { brush: 16, eraser: 26 };
  let disposed = false;
  let saving = false;
  /** Id of the gallery entry this session writes to, so repeats update it. */
  let sessionDrawingId: string | null = null;
  let sizePopover: HTMLElement | null = null;

  const setMagnet = (on: boolean): void => {
    book.setClip(on);
    magnetBtn.classList.toggle("is-on", on);
    magnetBtn.setAttribute("aria-pressed", String(on));
    const iconName = on ? "magnet" : "magnetOff";
    magnetBtn.replaceChildren(icon(iconName, 26));
    if (settings.magnetLocked) {
      const badge = el("span", { class: "magnet__lock" }, [icon("lock", 14)]);
      magnetBtn.append(badge);
    }
  };

  const syncHistory = (): void => {
    undoBtn.disabled = !book.canUndo;
    redoBtn.disabled = !book.canRedo;
  };

  const paintDot = (): void => {
    const bucket = toolsRow.querySelector<HTMLButtonElement>('[data-tool="fill"] .tool__drop');
    if (bucket) bucket.style.background = color;
  };

  const closeSizePopover = (): void => {
    sizePopover?.remove();
    sizePopover = null;
    toolsRow.querySelectorAll(".tool").forEach((node) => {
      node.classList.remove("has-popover");
    });
  };

  const openSizePopover = (anchor: HTMLButtonElement, kind: "brush" | "eraser"): void => {
    if (sizePopover) {
      closeSizePopover();
      return;
    }
    const popover = el("div", { class: "sizes", attrs: { role: "group", "aria-label": "Размер" } });
    for (const size of BRUSH_SIZES) {
      const dot = el("span", { class: "sizes__dot", style: { width: `${size}px`, height: `${size}px` } });
      const btn = el(
        "button",
        {
          class: "sizes__btn",
          attrs: { type: "button", "aria-pressed": String(sizes[kind] === size) },
          on: {
            click: (event) => {
              event.stopPropagation();
              sizes = { ...sizes, [kind]: size };
              book.setSize(size);
              void store.saveSettings({ brushSize: size });
              sound.play("tool");
              closeSizePopover();
              renderTools();
            },
          },
        },
        [dot],
      );
      popover.append(btn);
    }
    anchor.classList.add("has-popover");
    popover.style.left = `${anchor.offsetLeft + anchor.offsetWidth / 2}px`;
    toolsRow.append(popover);
    sizePopover = popover;
    window.setTimeout(() => {
      if (sizePopover === popover) closeSizePopover();
    }, 4000);
  };

  const selectTool = (next: KidTool): void => {
    if (tool === next && next !== "fill") {
      const anchor = toolsRow.querySelector<HTMLButtonElement>(`[data-tool="${next}"]`);
      if (anchor) openSizePopover(anchor, next);
      return;
    }
    closeSizePopover();
    tool = next;
    book.setTool(next);
    if (next !== "fill") book.setSize(sizes[next]);
    hint.textContent = TOOL_HINTS[next];
    sound.play("tool");
    renderTools();
  };

  const renderTools = (): void => {
    toolsRow.replaceChildren();
    const items: { kind: KidTool; label: string }[] = [
      { kind: "fill", label: "Заливка" },
      { kind: "brush", label: "Кисть" },
      { kind: "eraser", label: "Ластик" },
    ];
    for (const item of items) {
      const node = el(
        "button",
        {
          class: `tool${tool === item.kind ? " is-active" : ""}`,
          attrs: { type: "button", "aria-pressed": String(tool === item.kind) },
          dataset: { tool: item.kind },
          on: { click: () => selectTool(item.kind) },
        },
        [
          item.kind === "fill"
            ? (() => {
                const wrap = el("span", { class: "tool__bucket" }, [icon("bucket", 32)]);
                const drop = el("span", { class: "tool__drop", style: { background: color } });
                wrap.append(drop);
                return wrap;
              })()
            : icon(item.kind === "brush" ? "brush" : "eraser", 32),
          el("span", { class: "tool__label", text: item.label }),
        ],
      );
      toolsRow.append(node);
    }

    toolsRow.append(
      holdButton({
        label: "Очистить",
        icon: icon("clear", 32),
        duration: 1200,
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
      }),
    );
    paintDot();
    if (sizePopover) {
      const active = toolsRow.querySelector<HTMLButtonElement>(`[data-tool="${tool}"]`);
      active?.classList.add("has-popover");
    }
  };

  const renderPalette = (): void => {
    for (const entry of PALETTE) {
      const light = entry.hex === "#ffffff";
      paletteRow.append(
        el("button", {
          class: `swatch${light ? " swatch--light" : ""}${entry.hex === color ? " is-active" : ""}`,
          attrs: { type: "button", role: "option", "aria-label": entry.name, "aria-selected": String(entry.hex === color) },
          dataset: { color: entry.hex },
          style: { background: entry.hex },
          on: {
            click: () => {
              color = entry.hex;
              book.setColor(color);
              sound.play("tap");
              paletteRow.querySelectorAll<HTMLElement>(".swatch").forEach((node) => {
                const active = node.dataset.color === color;
                node.classList.toggle("is-active", active);
                node.setAttribute("aria-selected", String(active));
              });
              paintDot();
            },
          },
        }),
      );
    }
  };

  // --- persistence ----------------------------------------------------------
  const autosave = (): void => {
    if (disposed || !book.hasPaint()) {
      if (!disposed) void store.clearDraft(pictureId);
      return;
    }
    book.flush();
    const snapshot = book.snapshot();
    if (snapshot) void store.saveDraft(pictureId, snapshot);
    else void store.clearDraft(pictureId);
  };

  const leave = (path: string): void => {
    autosave();
    navigate(path);
  };

  const finish = async (): Promise<void> => {
    if (saving) return;
    saving = true;
    doneBtn.disabled = true;
    try {
      const image = await book.exportDataUrl(1280);
      if (!image) return;
      const current = book.progress();
      const complete = current.ratio >= DONE_RATIO;
      const id = sessionDrawingId ?? `${pictureId}-${Date.now()}`;
      sessionDrawingId = id;
      await store.upsertDrawing({
        id,
        pictureId,
        albumId: albumId || null,
        title,
        image,
        createdAt: Date.now(),
      });
      await store.savePictureState(pictureId, {
        ratio: current.ratio,
        status: complete ? "done" : "draft",
      });
      if (complete) {
        await store.clearDraft(pictureId);
        await store.awardStar();
        platform.haptics("success");
        sound.play("done");
        disposed = true;
        navigate(`/reward/${pictureId}`);
        return;
      }
      await store.saveDraft(pictureId, book.snapshot() ?? "");
      sound.say("Ещё чуть-чуть?");
      hint.textContent = "Ещё чуть-чуть? Рисунок уже сохранён";
      window.setTimeout(() => {
        if (!disposed) hint.textContent = TOOL_HINTS[tool];
      }, 2600);
    } finally {
      saving = false;
      doneBtn.disabled = false;
    }
  };

  // --- wiring ---------------------------------------------------------------
  book.onHistory = syncHistory;
  // Progress feeds the album dots and the 85 % rule in `finish`. Status stays
  // "draft" until the child presses Готово on a finished picture.
  book.onPaint = (progress) => {
    void store.savePictureState(pictureId, { ratio: progress.ratio, status: "draft" });
  };

  undoBtn.addEventListener("click", () => {
    book.undo();
    sound.play("undo");
  });
  redoBtn.addEventListener("click", () => {
    book.redo();
    sound.play("tool");
  });
  doneBtn.addEventListener("click", () => void finish());

  magnetBtn.addEventListener("click", () => {
    if (settings.magnetLocked) {
      sound.play("miss");
      hint.textContent = "Магнит заперт взрослым";
      return;
    }
    const next = !magnetBtn.classList.contains("is-on");
    setMagnet(next);
    void store.saveSettings({ magnet: next });
    sound.play("magnet");
    platform.haptics("light");
  });

  const canvasBox = paint.querySelector<HTMLElement>(".paint__canvas")!;
  canvasBox.addEventListener("pointerdown", () => sound.unlock(), { once: true });

  const onVisibility = (): void => {
    if (document.visibilityState === "hidden") autosave();
  };
  document.addEventListener("visibilitychange", onVisibility);
  const autosaveTimer = window.setInterval(autosave, AUTOSAVE_MS);

  renderTools();
  renderPalette();
  syncHistory();

  void (async () => {
    settings = await store.settings();
    sizes = { brush: settings.brushSize, eraser: 26 };
    setMagnet(settings.magnet);
    book.setColor(color);
    book.setTool("fill");

    if (!art) {
      loading.textContent = "Картинка не найдена";
      return;
    }
    try {
      await book.load(art.svg, art.png ?? art.svg);
      loading.remove();
      const draft = await store.draft(pictureId);
      if (draft?.paint) await book.restore(draft.paint);
      syncHistory();
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
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("keydown", onKey);
    window.clearInterval(autosaveTimer);
    autosave();
    disposed = true;
  };
}

/** Kept for the router: S4 needs a picture id and nothing else. */
export function picturePath(pictureId: string): string {
  return href(`/picture/${pictureId}`);
}
