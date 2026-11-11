import { catalog } from "../data/albums";
import { navigate } from "../router";
import { sound } from "../sound";
import { BRUSH_SIZES, store, type Settings } from "../storage";
import { el } from "../ui/dom";
import { icon } from "../ui/icons";

/**
 * S9 (basic). Deliberately adult: dark section headings, dense grid, Nunito
 * 16/400, no fox, no stars. The visual break tells the adult "другой режим".
 *
 * Everything destructive here takes a hold plus an explicit confirm.
 */
export function renderParent(root: HTMLElement): () => void {
  const view = el("div", { class: "screen screen--adult" }, [
    el("header", { class: "adult__head" }, [
      el(
        "button",
        {
          class: "topbar__btn",
          attrs: { type: "button", "aria-label": "Назад" },
          on: { click: () => navigate("/menu") },
        },
        [icon("back", 28)],
      ),
      el("h1", { class: "adult__title", text: "Родителям" }),
    ]),
  ]);
  root.append(view);

  const body = el("div", { class: "adult__body" });
  view.append(body);
  let disposed = false;

  const section = (title: string): HTMLElement =>
    el("section", { class: "adult__section" }, [el("h2", { class: "adult__section-title", text: title })]);

  const row = (label: string, value: Node | string): HTMLElement =>
    el("div", { class: "adult__row" }, [
      el("span", { class: "adult__label", text: label }),
      typeof value === "string" ? el("span", { class: "adult__value", text: value }) : value,
    ]);

  const toggle = (on: boolean, onChange: (next: boolean) => void): HTMLButtonElement =>
    el(
      "button",
      {
        class: `adult__toggle${on ? " is-on" : ""}`,
        attrs: { type: "button", role: "switch", "aria-checked": String(on) },
        text: on ? "ВКЛ" : "ВЫКЛ",
        on: { click: () => onChange(!on) },
      },
    );

  const paint = (settings: Settings, stats: { drawings: number; stars: number }): void => {
    const drawing = section("Рисование");
    drawing.append(
      row("Магнит («не выходить за линии»)", toggle(settings.magnet, (next) => void patch({ magnet: next }))),
      row("Запереть магнит", toggle(settings.magnetLocked, (next) => void patch({ magnetLocked: next }))),
      row("Только заливка (без кистей и ластика)", toggle(settings.fillOnly, (next) => void patch({ fillOnly: next }))),
      row(
        "Размер кисти по умолчанию",
        el("div", { class: "adult__choices" }, [
          ...BRUSH_SIZES.map((size) =>
            el("button", {
              class: `adult__choice${settings.brushSize === size ? " is-on" : ""}`,
              attrs: { type: "button" },
              text: `${size} px`,
              on: { click: () => void patch({ brushSize: size }) },
            }),
          ),
        ]),
      ),
    );

    const progress = section("Прогресс");
    progress.append(
      row("Рисунков", String(stats.drawings)),
      row("Звёзд", String(stats.stars)),
      row("Альбомов", `${catalog.albums.filter((album) => album.available).length} из ${catalog.albums.length}`),
      el("div", { class: "adult__actions" }, [holdReset()]),
    );

    const audio = section("Звук");
    audio.append(
      row("Звуки", toggle(settings.sounds, (next) => void patch({ sounds: next }))),
      row("Голос Рыжика", toggle(settings.voice, (next) => void patch({ voice: next }))),
    );

    const privacy = section("Приватность");
    privacy.append(
      row("Анонимная статистика", toggle(settings.analytics, (next) => void patch({ analytics: next }))),
      el("p", {
        class: "adult__note",
        text:
          "Приложение не собирает данные и не отправляет их никуда. " +
          "Всё хранится на устройстве: рисунки, звёзды, настройки.",
      }),
      el("p", {
        class: "adult__note",
        text: "Рекламы и сторонних SDK нет. Внешние ссылки открываются только из этого раздела.",
      }),
    );

    const about = section("О приложении");
    about.append(row("Версия", "1.0.0 MVP"), row("Платформа", "веб / VK Mini App (каркас)"));

    body.replaceChildren(drawing, audio, progress, privacy, about);
  };

  /** Hold 2 s, then a second confirming tap: two different deliberate actions. */
  const holdReset = (): HTMLElement => {
    const wrap = el("div", { class: "adult__hold" });
    const btn = el(
      "button",
      { class: "btn btn--danger", attrs: { type: "button" } },
      [icon("clear", 22), el("span", { class: "btn__label", text: "Сбросить прогресс" })],
    );
    let armed = false;
    let timer = 0;
    const disarm = (): void => {
      window.clearTimeout(timer);
      armed = false;
      btn.classList.remove("is-armed");
      if (!btn.dataset.confirm) btn.querySelector(".btn__label")!.textContent = "Сбросить прогресс";
    };
    btn.addEventListener("pointerdown", () => {
      if (armed) return;
      btn.classList.add("is-armed");
      timer = window.setTimeout(() => {
        armed = true;
        btn.dataset.confirm = "1";
        btn.querySelector(".btn__label")!.textContent = "Нажмите ещё раз";
      }, 2000);
    });
    btn.addEventListener("pointerup", () => {
      if (!armed) disarm();
    });
    btn.addEventListener("pointerleave", disarm);
    btn.addEventListener("click", async () => {
      if (!armed) return;
      await store.resetProgress();
      armed = false;
      delete btn.dataset.confirm;
      btn.classList.remove("is-armed");
      btn.querySelector(".btn__label")!.textContent = "Прогресс сброшен";
      window.setTimeout(() => void refresh(), 900);
    });
    wrap.append(btn);
    return wrap;
  };

  const patch = async (changes: Partial<Settings>): Promise<void> => {
    const next = await store.saveSettings(changes);
    sound.configure(next);
    if (changes.sounds === false || changes.voice === false) sound.stop();
    await refresh();
  };

  const refresh = async (): Promise<void> => {
    const [settings, drawings, progress] = await Promise.all([
      store.settings(),
      store.drawings(),
      store.progress(),
    ]);
    if (disposed) return;
    paint(settings, { drawings: drawings.length, stars: progress.stars });
  };

  void refresh();

  return () => {
    disposed = true;
  };
}
