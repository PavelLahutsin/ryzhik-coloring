import { albumOfPicture, findPicture } from "../data/albums";
import { navigate } from "../router";
import { sound } from "../sound";
import { store } from "../storage";
import { el } from "../ui/dom";
import { icon } from "../ui/icons";

/**
 * S5. One star per finished picture, no grades, no waiting. Buttons are live
 * from the first frame so the child never sits through the confetti.
 */
export function renderReward(root: HTMLElement, pictureId: string): () => void {
  const picture = findPicture(albumOfPicture(pictureId)?.id ?? "", pictureId);
  const albumId = albumOfPicture(pictureId)?.id ?? "";

  const thumb = el("div", { class: "reward__thumb" });
  const starsValue = el("strong", { text: "0" });

  const view = el("div", { class: "screen screen--reward" }, [
    el("div", { class: "reward__burst", attrs: { "aria-hidden": "true" } }),
    thumb,
    el("h1", { class: "reward__title", text: "Как красиво!" }),
    el("p", { class: "reward__star" }, [
      icon("star", 34),
      el("span", { text: " +1  ·  всего " }),
      starsValue,
    ]),
    el("div", { class: "reward__actions" }, [
      el(
        "button",
        {
          class: "btn btn--primary btn--wide",
          attrs: { type: "button" },
          on: { click: () => navigate(albumId ? `/album/${albumId}` : "/albums") },
        },
        [icon("brush", 26), el("span", { class: "btn__label", text: "Ещё рисунок" })],
      ),
      el(
        "button",
        {
          class: "btn btn--ghost btn--wide",
          attrs: { type: "button" },
          on: { click: () => navigate("/drawings") },
        },
        [icon("picture", 26), el("span", { class: "btn__label", text: "В мои рисунки" })],
      ),
    ]),
  ]);
  root.append(view);
  sound.play("star");

  void (async () => {
    const [progress, drawings] = await Promise.all([store.progress(), store.drawings()]);
    starsValue.textContent = String(progress.stars);
    const drawing = drawings.find((item) => item.pictureId === pictureId);
    if (drawing) {
      thumb.replaceChildren(el("img", { attrs: { src: drawing.image, alt: "" } }));
    } else if (picture) {
      thumb.replaceChildren(el("span", { class: "reward__mark", text: "🖼" }));
    }
  })();

  return () => undefined;
}
