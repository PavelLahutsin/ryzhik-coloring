import { navigate } from "../router";
import { sound } from "../sound";
import { store, type Settings } from "../storage";
import { el } from "../ui/dom";
import { icon, type IconName } from "../ui/icons";
import { topbar } from "../ui/topbar";

/**
 * S7. Only what a child may change alone. Everything else lives behind S8.
 * Each switch shows its state three ways: label, colour, position.
 */
type ToggleKey = Extract<keyof Settings, "music" | "sounds" | "voice">;

const ROWS: { key: ToggleKey; label: string; icon: IconName }[] = [
  { key: "music", label: "Музыка", icon: "music" },
  { key: "sounds", label: "Звуки", icon: "sound" },
  { key: "voice", label: "Голос Рыжика", icon: "voice" },
];

export function renderSound(root: HTMLElement): () => void {
  const list = el("div", { class: "switch-list" });
  const view = el("div", { class: "screen" }, [
    topbar({ title: "Звук", onBack: () => navigate("/menu"), onHome: () => navigate("/menu") }),
    list,
    el("div", { class: "screen__footer" }, [
      el(
        "button",
        {
          class: "btn btn--ghost btn--wide",
          attrs: { type: "button" },
          on: { click: () => navigate("/gate/parent") },
        },
        [icon("lock", 22), el("span", { class: "btn__label", text: "Родителям" })],
      ),
    ]),
  ]);
  root.append(view);

  let disposed = false;
  let settings: Settings | null = null;

  const paint = (): void => {
    if (!settings) return;
    list.replaceChildren(
      ...ROWS.map((row) => {
        const on = settings?.[row.key] ?? false;
        return el(
          "button",
          {
            class: `switch-row${on ? " is-on" : ""}`,
            attrs: { type: "button", role: "switch", "aria-checked": String(on) },
            on: {
              click: async () => {
                const next = !settings?.[row.key];
                settings = await store.saveSettings({ [row.key]: next });
                sound.configure(settings);
                sound.unlock();
                sound.play("tap");
                paint();
              },
            },
          },
          [
            el("span", { class: "switch-row__icon" }, [icon(row.icon, 28)]),
            el("span", { class: "switch-row__label", text: row.label }),
            el("span", { class: "switch-row__state", text: on ? "ВКЛ" : "ВЫКЛ" }),
            el("span", { class: "switch", attrs: { "aria-hidden": "true" } }),
          ],
        );
      }),
    );
  };

  void store.settings().then((loaded) => {
    if (disposed) return;
    settings = loaded;
    sound.configure(loaded);
    paint();
  });

  return () => {
    disposed = true;
  };
}
