import { navigate } from "../router";
import { platform } from "../platform";
import { store, type Drawing } from "../storage";
import { el } from "../ui/dom";
import { icon } from "../ui/icons";
import { topbar } from "../ui/topbar";

type ExportKind = "save" | "share";

type PendingExport = { kind: ExportKind; image: string; filename: string; text: string };

/** Held in memory only until the adult passes the gate. */
let pendingExport: PendingExport | null = null;

function stageExport(value: PendingExport): void {
  pendingExport = value;
  navigate(`/gate/${value.kind}`);
}

/**
 * S6 (basic). Newest first, no dates or captions: the child needs pictures,
 * the adult can open one and see everything else behind the gate.
 */
export function renderDrawings(root: HTMLElement): () => void {
  const grid = el("div", { class: "gallery" });
  const empty = el("div", { class: "empty-state" }, [
    el("span", { class: "empty-state__mark", text: "🖌" }),
    el("p", { class: "empty-state__text", text: "Пока пусто" }),
    el(
      "button",
      {
        class: "btn btn--primary",
        attrs: { type: "button" },
        on: { click: () => navigate("/albums") },
      },
      [icon("bucket", 26), el("span", { class: "btn__label", text: "Раскрасить" })],
    ),
  ]);
  empty.hidden = true;

  const view = el("div", { class: "screen" }, [
    topbar({ title: "Мои рисунки", onBack: () => navigate("/menu"), onHome: () => navigate("/menu") }),
    grid,
    empty,
  ]);
  root.append(view);

  let disposed = false;
  let drawings: Drawing[] = [];

  const overlay = el("div", { class: "viewer", attrs: { hidden: true, role: "dialog", "aria-label": "Рисунок" } });
  document.body.append(overlay);

  const closeViewer = (): void => {
    overlay.hidden = true;
    overlay.replaceChildren();
  };

  const openViewer = (drawing: Drawing): void => {
    const removeBtn = el(
      "button",
      { class: "btn btn--danger", attrs: { type: "button" } },
      [icon("clear", 22), el("span", { class: "btn__label", text: "Удалить" })],
    );
    // Delete needs a hold, same rule as clearing the canvas.
    let timer = 0;
    const start = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        await store.removeDrawing(drawing.id);
        drawings = drawings.filter((item) => item.id !== drawing.id);
        paintGrid();
        closeViewer();
      }, 1200);
    };
    const stop = (): void => window.clearTimeout(timer);
    removeBtn.addEventListener("pointerdown", start);
    removeBtn.addEventListener("pointerup", stop);
    removeBtn.addEventListener("pointerleave", stop);

    overlay.replaceChildren(
      el("div", { class: "viewer__panel" }, [
        el("img", { class: "viewer__image", attrs: { src: drawing.image, alt: drawing.title } }),
        el("div", { class: "viewer__actions" }, [
          el(
            "button",
            {
              class: "btn btn--primary",
              attrs: { type: "button" },
              on: { click: () => navigate(`/picture/${drawing.pictureId}/${drawing.id}`) },
            },
            [icon("brush", 22), el("span", { class: "btn__label", text: "Дорисовать" })],
          ),
          el(
            "button",
            {
              class: "btn btn--primary",
              attrs: { type: "button" },
              on: {
                click: () =>
                  stageExport({
                    kind: "save",
                    image: drawing.image,
                    filename: `${drawing.pictureId}.png`,
                    text: "Готовый рисунок Рыжика",
                  }),
              },
            },
            [icon("check", 22), el("span", { class: "btn__label", text: "Сохранить" })],
          ),
          platform.canShare()
            ? el(
                "button",
                {
                  class: "btn btn--ghost",
                  attrs: { type: "button" },
                  // Saving and sharing both leave the app, so both sit behind S8.
                  on: {
                    click: () =>
                      stageExport({
                        kind: "share",
                        image: drawing.image,
                        filename: "ryzhik.png",
                        text: "Раскраска с Рыжиком",
                      }),
                  },
                },
                [el("span", { class: "btn__label", text: "Поделиться" })],
              )
            : null,
          removeBtn,
          el(
            "button",
            {
              class: "btn btn--ghost",
              attrs: { type: "button" },
              on: { click: closeViewer },
            },
            [el("span", { class: "btn__label", text: "Назад" })],
          ),
        ]),
      ]),
    );
    overlay.hidden = false;
  };

  const paintGrid = (): void => {
    if (drawings.length === 0) {
      grid.replaceChildren();
      grid.hidden = true;
      empty.hidden = false;
      return;
    }
    grid.hidden = false;
    empty.hidden = true;
    grid.replaceChildren(
      ...drawings.map((drawing) =>
        el(
          "button",
          {
            class: "gallery__item",
            attrs: { type: "button", "aria-label": drawing.title },
            on: { click: () => openViewer(drawing) },
          },
          [el("img", { attrs: { src: drawing.image, alt: "", loading: "lazy" } })],
        ),
      ),
    );
  };

  void store.drawings().then((list) => {
    if (disposed) return;
    drawings = list;
    paintGrid();
  });

  const onBack = (event: Event): void => {
    if (overlay.hidden) return;
    closeViewer();
    event.preventDefault();
  };
  window.addEventListener("ryzhik:back", onBack);

  return () => {
    disposed = true;
    window.removeEventListener("ryzhik:back", onBack);
    overlay.remove();
  };
}

/**
 * Reached only after the parental gate. Runs the save or share that was
 * staged on the gallery, then offers a way back to the pictures.
 */
export function renderExport(root: HTMLElement, kind: ExportKind): () => void {
  const job = pendingExport && pendingExport.kind === kind ? pendingExport : null;
  pendingExport = null;
  const status = el("p", {
    class: "empty-state__text",
    text: job ? "Секунду…" : "Нечего сохранять",
  });
  const view = el("div", { class: "screen" }, [
    topbar({
      title: kind === "save" ? "Сохранить" : "Поделиться",
      onBack: () => navigate("/drawings"),
      onHome: () => navigate("/menu"),
    }),
    el("div", { class: "empty-state" }, [
      status,
      el(
        "button",
        {
          class: "btn btn--primary",
          attrs: { type: "button" },
          on: { click: () => navigate("/drawings") },
        },
        [el("span", { class: "btn__label", text: "К рисункам" })],
      ),
    ]),
  ]);
  root.append(view);
  if (job) {
    const run = kind === "save" ? platform.saveImage(job.image, job.filename) : platform.share(job);
    void run.then(
      (ok) => {
        status.textContent = ok ? "Готово" : "Не получилось. Попробуйте ещё раз.";
      },
      () => {
        status.textContent = "Не получилось. Попробуйте ещё раз.";
      },
    );
  }
  return () => undefined;
}
