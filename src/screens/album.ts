import { artFor, findAlbum, type PictureEntry } from "../data/albums";
import { navigate } from "../router";
import { sound } from "../sound";
import { store, type PictureState } from "../storage";
import { el } from "../ui/dom";
import { icon } from "../ui/icons";
import { topbar } from "../ui/topbar";

/**
 * S3. Previews are the real line art, never a generic icon: the child picks
 * with their eyes. Statuses: clean / started (▶) / finished (✓). A finished
 * picture can always be coloured again.
 */
export function renderAlbum(root: HTMLElement, albumId: string): () => void {
  const album = findAlbum(albumId);
  const grid = el("div", { class: "pictures" });
  const view = el("div", { class: "screen" }, [
    topbar({
      title: album?.title ?? "Альбом",
      onBack: () => navigate("/albums"),
      onHome: () => navigate("/menu"),
    }),
    album && album.pictures.length > 0
      ? grid
      : el("p", { class: "empty", text: "Здесь пока пусто" }),
  ]);
  root.append(view);

  if (!album) {
    grid.replaceWith(el("p", { class: "empty", text: "Альбом не найден" }));
    return () => undefined;
  }

  let disposed = false;

  const preview = (picture: PictureEntry, state: PictureState | null): HTMLElement => {
    const art = artFor(picture.id);
    const status = state?.status ?? "new";
    const node = el(
      "button",
      {
        class: "preview",
        attrs: { type: "button", "aria-label": `${picture.title}${status === "done" ? ", готово" : ""}` },
        on: {
          click: () => {
            sound.play("tap");
            navigate(`/picture/${picture.id}`);
          },
        },
      },
      [
        el("span", { class: "preview__frame" }, [
          art
            ? el("img", { class: "preview__art", attrs: { src: art.svg, alt: "", loading: "lazy" } })
            : el("span", { class: "preview__mark", text: "🖼" }),
        ]),
        el("span", { class: "preview__title", text: picture.title }),
        status === "done"
          ? el("span", { class: "preview__badge preview__badge--done" }, [icon("check", 20)])
          : status === "draft"
            ? el("span", { class: "preview__badge preview__badge--draft" }, [icon("chevronRight", 18)])
            : null,
      ],
    );
    return node;
  };

  void (async () => {
    const progress = await store.progress();
    const nodes = album.pictures.map((picture) =>
      preview(picture, progress.pictures[picture.id] ?? null),
    );
    if (!disposed) grid.replaceChildren(...nodes);
  })();

  return () => {
    disposed = true;
  };
}
