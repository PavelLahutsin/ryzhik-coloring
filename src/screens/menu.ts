import ryzhikWave from "../assets/ryzhik/ryzhik-wave.webp";
import { navigate } from "../router";
import { sound } from "../sound";
import { store } from "../storage";
import { el } from "../ui/dom";
import { icon } from "../ui/icons";

/**
 * S1. Four big entrances, nothing else. No hamburger, no banners, no store.
 * "Родителям" is deliberately dull: 56dp, outline, soft ink.
 */
export function renderMenu(root: HTMLElement): () => void {
  const stars = el("strong", { class: "chip__value", text: "0" });
  const soundBtn = el(
    "button",
    {
      class: "tile tile--small",
      attrs: { type: "button" },
      on: { click: () => go("/sound") },
    },
    [
      el("span", { class: "tile__icon", attrs: { "aria-hidden": "true" } }, [icon("music", 34)]),
      el("span", { class: "tile__label", text: "Звук" }),
    ],
  );

  const view = el("div", { class: "screen screen--menu" }, [
    el("header", { class: "menu__head" }, [
      el("div", { class: "brand" }, [
        el("img", { class: "brand__fox", attrs: { src: ryzhikWave, alt: "" } }),
        el("div", { class: "brand__text" }, [
          el("h1", { class: "brand__title", text: "Раскраска" }),
          el("p", { class: "brand__sub", text: "с Рыжиком" }),
        ]),
      ]),
      el("button", {
        class: "btn btn--parent",
        attrs: { type: "button" },
        text: "Родителям",
        on: { click: () => go("/gate/parent") },
      }),
    ]),
    el("main", { class: "menu__grid" }, [
      el(
        "button",
        {
          class: "tile tile--primary",
          attrs: { type: "button" },
          on: { click: () => go("/albums") },
        },
        [
          el("span", { class: "tile__icon", attrs: { "aria-hidden": "true" } }, [icon("bucket", 44)]),
          el("span", { class: "tile__label", text: "Раскраски" }),
        ],
      ),
      el(
        "button",
        {
          class: "tile",
          attrs: { type: "button" },
          on: { click: () => go("/drawings") },
        },
        [
          el("span", { class: "tile__icon", attrs: { "aria-hidden": "true" } }, [icon("picture", 44)]),
          el("span", { class: "tile__label", text: "Мои рисунки" }),
        ],
      ),
      el("div", { class: "menu__row" }, [
        soundBtn,
        el("div", { class: "chip", attrs: { "aria-label": "Звёзды" } }, [
          el("span", { class: "chip__icon", attrs: { "aria-hidden": "true" } }, [icon("star", 34)]),
          stars,
        ]),
      ]),
    ]),
    el("p", { class: "menu__say", text: "«Давай вместе!»" }),
  ]);
  root.append(view);

  void store.progress().then((progress) => {
    stars.textContent = String(progress.stars);
  });

  return () => {
    /* nothing to release */
  };
}

function go(path: string): void {
  sound.unlock();
  sound.play("tap");
  navigate(path);
}
