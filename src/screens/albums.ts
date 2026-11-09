import { shippedAlbums, type AlbumEntry } from "../data/albums";
import { navigate } from "../router";
import { sound } from "../sound";
import { store } from "../storage";
import { el } from "../ui/dom";
import { topbar } from "../ui/topbar";

/**
 * S2. Album covers with progress dots. Dots read faster than percentages and
 * need no counting. Albums that are not shipped yet stay visible but dimmed,
 * so the child is not surprised by a dead end.
 */
export function renderAlbums(root: HTMLElement): () => void {
  const grid = el("div", { class: "cards" });
  const view = el("div", { class: "screen" }, [
    topbar({ title: "Альбомы", onBack: () => navigate("/menu"), onHome: () => navigate("/menu") }),
    grid,
  ]);
  root.append(view);

  let disposed = false;

  const card = (album: AlbumEntry, done: number): HTMLElement => {
    const available = album.available && album.pictures.length > 0;
    const dots = el("div", { class: "dots", attrs: { "aria-hidden": "true" } });
    const total = Math.max(album.pictures.length, 1);
    for (let i = 0; i < total; i++) {
      dots.append(el("span", { class: `dots__dot${i < done ? " is-done" : ""}` }));
    }

    const node = el(
      "button",
      {
        class: `card${available ? "" : " is-soon"}`,
        attrs: { type: "button", disabled: !available },
        on: {
          click: () => {
            if (!available) {
              sound.play("locked");
              return;
            }
            sound.play("album");
            navigate(`/album/${album.id}`);
          },
        },
      },
      [
        el("span", { class: "card__cover" }, [
          el("span", { class: "card__mark", text: album.emoji ?? "🦊" }),
        ]),
        el("span", { class: "card__title", text: album.title }),
        available
          ? dots
          : el("span", { class: "card__soon", text: "скоро" }),
      ],
    );
    return node;
  };

  void (async () => {
    const progress = await store.progress();
    const rendered: HTMLElement[] = [];
    for (const album of shippedAlbums()) {
      const done = album.pictures.filter(
        (picture) => progress.pictures[picture.id]?.status === "done",
      ).length;
      rendered.push(card(album, done));
    }
    if (!disposed) grid.replaceChildren(...rendered);
  })();

  return () => {
    disposed = true;
  };
}
