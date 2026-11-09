import "@fontsource/comfortaa/cyrillic-700.css";
import "@fontsource/comfortaa/latin-700.css";
import "@fontsource/nunito/cyrillic-400.css";
import "@fontsource/nunito/cyrillic-700.css";
import "@fontsource/nunito/cyrillic-800.css";
import "@fontsource/nunito/latin-400.css";
import "@fontsource/nunito/latin-700.css";
import "@fontsource/nunito/latin-800.css";
import "./style.css";

import { platform } from "./platform";
import { navigate, startRouter, type Route } from "./router";
import { renderAlbum } from "./screens/album";
import { renderAlbums } from "./screens/albums";
import { isParentUnlocked, renderGate } from "./screens/gate";
import { mountPicture } from "./screens/coloring";
import { renderDrawings } from "./screens/drawings";
import { renderMenu } from "./screens/menu";
import { renderMissing } from "./screens/missing";
import { renderParent } from "./screens/parent";
import { renderReward } from "./screens/reward";
import { renderSound } from "./screens/sound";
import { sound } from "./sound";
import { store } from "./storage";
import { el } from "./ui/dom";

type Cleanup = () => void;

const root = document.getElementById("app");
if (!root) throw new Error("Нет #app");

let cleanup: Cleanup | null = null;

function render(route: Route): void {
  cleanup?.();
  cleanup = null;
  root?.replaceChildren();

  switch (route.name) {
    case "menu":
      cleanup = renderMenu(root!);
      break;
    case "albums":
      cleanup = renderAlbums(root!);
      break;
    case "album":
      cleanup = renderAlbum(root!, route.albumId);
      break;
    case "picture":
      cleanup = mountPicture(root!, route.pictureId, route.drawingId);
      break;
    case "reward":
      cleanup = renderReward(root!, route.pictureId, route.drawingId, route.newStar === true);
      break;
    case "drawings":
      cleanup = renderDrawings(root!);
      break;
    case "sound":
      cleanup = renderSound(root!);
      break;
    case "gate":
      cleanup = renderGate(root!, route.next);
      break;
    case "parent":
      // The adult section is reachable only through S8 in this session.
      if (!isParentUnlocked()) {
        navigate("/gate/parent");
        return;
      }
      cleanup = renderParent(root!);
      break;
    default:
      cleanup = renderMissing(root!);
  }
  document.body.dataset.route = route.name;
}

/** First gesture unlocks audio; autocapture means no screen has to remember. */
function armAudio(): void {
  sound.unlock();
  document.removeEventListener("pointerdown", armAudio);
  document.removeEventListener("keydown", armAudio);
}
document.addEventListener("pointerdown", armAudio, { once: true });
document.addEventListener("keydown", armAudio, { once: true });

void store.settings().then((settings) => {
  sound.configure(settings);
  document.documentElement.dataset.motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    .matches
    ? "reduced"
    : "full";
});

// A stray double tap must never zoom or select text in the child area.
document.addEventListener("dblclick", (event) => event.preventDefault(), { passive: false });
document.addEventListener("contextmenu", (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest(".sheet")) event.preventDefault();
});

window.addEventListener("error", () => {
  const box = el("p", { class: "fatal", text: "Что-то пошло не так. Перезагрузите страницу." });
  root?.append(box);
});

startRouter(render);

// Exposed for the manual QA pass and for the future VK/Capacitor shells.
void platform;
