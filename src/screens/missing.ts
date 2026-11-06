import { navigate } from "../router";
import { el } from "../ui/dom";
import { icon } from "../ui/icons";

/** Unknown hash: keep the child inside the app instead of showing a dead end. */
export function renderMissing(root: HTMLElement): () => void {
  const view = el("div", { class: "screen screen--missing" }, [
    el("p", { class: "empty-state__mark", text: "🦊" }),
    el("p", { class: "empty-state__text", text: "Тут ничего нет" }),
    el(
      "button",
      {
        class: "btn btn--primary",
        attrs: { type: "button" },
        on: { click: () => navigate("/menu") },
      },
      [icon("home", 24), el("span", { class: "btn__label", text: "На главную" })],
    ),
  ]);
  root.append(view);
  return () => undefined;
}
