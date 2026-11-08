import ryzhikWave from "../assets/ryzhik/ryzhik-wave.webp";
import { catalog } from "../data/albums";
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
  let starCount = 0;
  const stars = el("strong", { class: "chip__value", text: "0" });
  const starNote = el("span", { class: "chip__note", text: "за готовые рисунки" });
  const starBtn = el(
    "button",
    {
      class: "chip",
      attrs: { type: "button", "aria-label": "Звёзды за готовые рисунки" },
      on: {
        click: () => {
          sound.unlock();
          sound.play("tap");
          starNote.textContent =
            starCount > 0 ? "Звезда — за каждый готовый рисунок" : "Звезда появится, когда рисунок готов";
        },
      },
    },
    [
      el("span", { class: "chip__icon", attrs: { "aria-hidden": "true" } }, [icon("star", 34)]),
      stars,
      starNote,
    ],
  );
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
      el("div", { class: "menu__row" }, [soundBtn, starBtn]),
    ]),
    el(
      "button",
      {
        class: "menu__go",
        attrs: { type: "button" },
        on: { click: () => go(firstPicture()) },
      },
      [el("span", { class: "menu__go-label", text: "Давай раскрасим вместе!" })],
    ),
  ]);
  root.append(view);

  void store.progress().then((progress) => {
    starCount = progress.stars;
    stars.textContent = String(progress.stars);
  });

  return () => {
    /* nothing to release */
  };
}

function firstPicture(): string {
  const album = catalog.albums.find((item) => item.available && item.pictures.length > 0);
  const picture = album?.pictures[0];
  return picture ? `/picture/${picture.id}` : "/albums";
}

function go(path: string): void {
  sound.unlock();
  sound.play("tap");
  navigate(path);
}
