import { el } from "./dom";
import { icon } from "./icons";

export type TopbarOptions = {
  title?: string;
  onBack?: () => void;
  /** Omit to hide the home button on screens that are already home. */
  onHome?: () => void;
  variant?: "kid" | "adult";
  trailing?: (Node | null)[];
  /** Extra class on the bar, e.g. for the colouring screen. */
  class?: string;
};

/**
 * Shared top bar. Back and home are always at least 64dp — the smallest tap
 * target the design document allows in the child area.
 */
export function topbar(options: TopbarOptions): HTMLElement {
  const bar = el("header", {
    class: `topbar topbar--${options.variant ?? "kid"}${options.class ? ` ${options.class}` : ""}`,
  });

  if (options.onBack) {
    bar.append(
      el(
        "button",
        {
          class: "topbar__btn",
          attrs: { type: "button", "aria-label": "Назад" },
          on: { click: () => options.onBack?.() },
        },
        [icon("back", 30)],
      ),
    );
  }

  if (options.title) {
    bar.append(el("h1", { class: "topbar__title", text: options.title }));
  } else {
    bar.append(el("span", { class: "topbar__title topbar__title--empty" }));
  }

  const trailing = el("div", { class: "topbar__trailing" });
  for (const node of options.trailing ?? []) if (node) trailing.append(node);
  if (options.onHome) {
    trailing.append(
      el(
        "button",
        {
          class: "topbar__btn",
          attrs: { type: "button", "aria-label": "На главную" },
          on: { click: () => options.onHome?.() },
        },
        [icon("home", 28)],
      ),
    );
  }
  bar.append(trailing);
  return bar;
}
