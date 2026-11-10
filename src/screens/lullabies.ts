import { lullabies, type Lullaby } from "../data/lullabies";
import { navigate } from "../router";
import { sound } from "../sound";
import { LULLABY_MINUTES, store, type LullabyMinutes } from "../storage";
import { el } from "../ui/dom";
import { icon } from "../ui/icons";
import { topbar } from "../ui/topbar";

/**
 * «Колыбельные» с режимом сна. Тёмный экран, без анимаций и мигания.
 * Одна колыбельная за раз, список идёт по кругу. Звуки интерфейса и фразы
 * Рыжика здесь не звучат (sound.silence). Таймер сна: в последнюю минуту звук
 * плавно затихает, затем пауза и освобождение ресурсов.
 */

const FADE_MS = 60_000;
const TICK_MS = 1_000;
const DEFAULT_MINUTES: LullabyMinutes = 20;

function isMinutes(value: unknown): value is LullabyMinutes {
  return (LULLABY_MINUTES as readonly number[]).includes(value as number);
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function renderLullabies(root: HTMLElement): () => void {
  const tracks: Lullaby[] = lullabies;
  let disposed = false;
  /** null until settings load; play is blocked until then. */
  let musicOn: boolean | null = null;
  let minutes: LullabyMinutes = DEFAULT_MINUTES;
  let index = 0;
  let playing = false;
  let failed = false;
  let remainingMs = DEFAULT_MINUTES * 60_000;
  let lastTick = 0;
  let timer: number | null = null;
  /** Index of the track currently loaded in `audio`, -1 when released. */
  let loadedIndex = -1;

  // One element for the whole screen: only one lullaby can ever sound.
  const audio = new Audio();
  audio.preload = "auto";
  audio.setAttribute("playsinline", "");
  let graph: { ctx: AudioContext; source: MediaElementAudioSourceNode; gain: GainNode } | null = null;

  /* ---------- audio graph ---------- */

  function ensureGraph(): void {
    if (graph) return;
    const ctx = sound.context();
    if (!ctx) return;
    try {
      const source = ctx.createMediaElementSource(audio);
      const gain = ctx.createGain();
      source.connect(gain);
      gain.connect(ctx.destination);
      graph = { ctx, source, gain };
    } catch {
      /* Without Web Audio the fade falls back to audio.volume. */
      graph = null;
    }
  }

  function setLevel(level: number, rampSec = 0): void {
    const value = Math.min(1, Math.max(0, level));
    if (!graph) {
      audio.volume = value;
      return;
    }
    const { ctx, gain } = graph;
    const now = ctx.currentTime;
    const param = gain.gain;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    if (rampSec > 0) param.linearRampToValueAtTime(value, now + rampSec);
    else param.setValueAtTime(value, now);
  }

  /* ---------- transport ---------- */

  function startTick(): void {
    if (timer !== null) return;
    lastTick = Date.now();
    timer = window.setInterval(tick, TICK_MS);
  }

  function stopTick(): void {
    if (timer === null) return;
    window.clearInterval(timer);
    timer = null;
  }

  /** Pause, keep the position and the timer. */
  function halt(): void {
    playing = false;
    stopTick();
    audio.pause();
  }

  /** Pause and free the decoder. The next play starts the track from the beginning. */
  function release(): void {
    halt();
    // Clear the index before load(), which can fire "error" for the empty source.
    loadedIndex = -1;
    audio.removeAttribute("src");
    audio.load();
  }

  function tick(): void {
    const now = Date.now();
    remainingMs -= now - lastTick;
    lastTick = now;
    if (remainingMs <= 0) {
      // Sleep timer finished: silence, release, and rearm for the next play.
      release();
      remainingMs = minutes * 60_000;
      paint();
      return;
    }
    setLevel(remainingMs <= FADE_MS ? remainingMs / FADE_MS : 1, TICK_MS / 1000);
    paintTimer();
  }

  function play(): void {
    if (disposed || tracks.length === 0) return;
    if (musicOn !== true) {
      paint();
      return;
    }
    // Synchronous on purpose: iOS only starts audio inside the tap handler.
    sound.unlock();
    ensureGraph();
    if (loadedIndex !== index) {
      audio.src = tracks[index].url;
      loadedIndex = index;
    }
    if (remainingMs <= 0) remainingMs = minutes * 60_000;
    setLevel(remainingMs <= FADE_MS ? remainingMs / FADE_MS : 1);
    playing = true;
    failed = false;
    startTick();
    paint();
    // play() stays inside this tap: iOS will not start audio after an await.
    void audio.play().catch((error: unknown) => {
      // Pausing or switching tracks rejects the pending play() with AbortError: that is not a failure.
      if (disposed || !playing) return;
      const name = error instanceof DOMException ? error.name : "";
      if (name === "AbortError") return;
      halt();
      failed = true;
      paint();
    });
  }

  function togglePlay(): void {
    if (playing) {
      halt();
      paint();
    } else {
      play();
    }
  }

  function selectTrack(i: number): void {
    if (tracks.length === 0) return;
    if (i === index && playing) {
      togglePlay();
      return;
    }
    index = i;
    loadedIndex = -1;
    play();
  }

  function next(): void {
    if (tracks.length === 0) return;
    index = (index + 1) % tracks.length;
    loadedIndex = -1;
    if (playing) {
      play();
    } else {
      audio.removeAttribute("src");
      audio.load();
      paint();
    }
  }

  function chooseMinutes(value: LullabyMinutes): void {
    minutes = value;
    remainingMs = value * 60_000;
    if (playing) {
      lastTick = Date.now();
      setLevel(1);
    }
    paint();
    void store.saveSettings({ lullabyMinutes: value });
  }

  /* ---------- DOM ---------- */

  const hint = el("div", { class: "lull-hint", attrs: { role: "status" } }, [
    el("p", {
      class: "lull-hint__text",
      text: "Музыка выключена. Включите её в разделе «Звук» или попросите родителей.",
    }),
    el(
      "button",
      {
        class: "btn lull-hint__btn",
        attrs: { type: "button" },
        on: { click: () => navigate("/sound") },
      },
      [icon("music", 26), el("span", { class: "btn__label", text: "Открыть «Звук»" })],
    ),
  ]);

  const nowTitle = el("p", { class: "lull-now__title" });
  const nowState = el("p", { class: "lull-now__state" });
  const playIconSlot = el("span", { class: "lull-play__icon", attrs: { "aria-hidden": "true" } });
  const playLabel = el("span", { class: "lull-play__label" });
  const playBtn = el(
    "button",
    {
      class: "lull-play",
      attrs: { type: "button" },
      on: { click: togglePlay },
    },
    [playIconSlot, playLabel],
  );
  const nextBtn = el(
    "button",
    {
      class: "lull-next",
      attrs: { type: "button" },
      on: { click: next },
    },
    [icon("chevronRight", 34), el("span", { class: "btn__label", text: "Дальше" })],
  );

  const timerButtons = LULLABY_MINUTES.map((value) =>
    el(
      "button",
      {
        class: "lull-timer__btn",
        attrs: { type: "button", "aria-pressed": "false" },
        on: { click: () => chooseMinutes(value) },
      },
      [
        el("span", { class: "lull-timer__num", text: String(value) }),
        el("span", { class: "lull-timer__unit", text: "мин" }),
      ],
    ),
  );
  const timerLeft = el("p", { class: "lull-timer__left" });

  const cardStates: HTMLElement[] = [];
  const cards = tracks.map((track, i) => {
    const state = el("span", { class: "lull-card__state" });
    cardStates.push(state);
    return el(
      "button",
      {
        class: "lull-card",
        attrs: { type: "button" },
        on: { click: () => selectTrack(i) },
      },
      [
        el("span", { class: "lull-card__num", text: String(i + 1) }),
        el("span", { class: "lull-card__title", text: track.title }),
        state,
      ],
    );
  });

  const body =
    tracks.length === 0
      ? el("div", { class: "empty-state lull-empty" }, [
          el("p", { class: "empty-state__mark", text: "🌙", attrs: { "aria-hidden": "true" } }),
          el("p", { class: "empty-state__text", text: "Скоро здесь будут колыбельные Рыжика" }),
        ])
      : el("main", { class: "lull" }, [
          hint,
          el("section", { class: "lull-now" }, [nowTitle, nowState]),
          el("div", { class: "lull-controls" }, [playBtn, nextBtn]),
          el("section", { class: "lull-timer" }, [
            el("p", { class: "lull-section", text: "Таймер сна" }),
            el("div", { class: "lull-timer__row" }, timerButtons),
            timerLeft,
          ]),
          el("section", { class: "lull-list", attrs: { "aria-label": "Список колыбельных" } }, cards),
          el("p", {
            class: "lull-note",
            text: "Колыбельные играют по кругу, одна за раз.",
          }),
        ]);

  const view = el("div", { class: "screen screen--lullaby" }, [
    topbar({
      title: "Колыбельные",
      onBack: () => navigate("/menu"),
      onHome: () => navigate("/menu"),
    }),
    body,
  ]);
  root.append(view);

  function paintTimer(): void {
    timerLeft.textContent = `Осталось ${formatTime(remainingMs)}. В последнюю минуту звук тихо затихнет.`;
  }

  function paint(): void {
    if (tracks.length === 0) return;
    const track = tracks[index];
    hint.hidden = musicOn !== false;
    nowTitle.textContent = track.title;
    nowState.textContent = failed
      ? "Эту колыбельную пока не получилось включить"
      : playing
        ? "Сейчас играет"
        : "Нажмите «Играть»";
    playIconSlot.replaceChildren(icon(playing ? "pause" : "play", 40));
    playLabel.textContent = playing ? "Пауза" : "Играть";
    playBtn.setAttribute("aria-label", playing ? "Пауза" : "Играть");
    timerButtons.forEach((button, i) => {
      const on = LULLABY_MINUTES[i] === minutes;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", String(on));
    });
    paintTimer();
    tracks.forEach((_, i) => {
      const current = i === index;
      cards[i].classList.toggle("is-current", current);
      cardStates[i].textContent = current && playing ? "Играет" : current && failed ? "Не получилось включить" : "";
    });
  }

  /* ---------- lifecycle ---------- */

  const onVisibility = (): void => {
    if (document.visibilityState === "hidden") {
      release();
      paint();
    }
  };
  const onPageHide = (): void => release();

  sound.silence(true);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  // Android often skips visibilitychange when the app is backgrounded.
  window.addEventListener("ryzhik:background", onPageHide);

  const onEnded = (): void => {
    if (disposed || !playing) return;
    index = (index + 1) % tracks.length;
    loadedIndex = -1;
    play();
  };
  const onAudioError = (): void => {
    if (disposed || !playing || loadedIndex < 0) return;
    // 1 is MEDIA_ERR_ABORTED: pause, a new src, or release(). Not a broken file.
    if (audio.error?.code === 1) return;
    halt();
    failed = true;
    paint();
  };
  audio.addEventListener("ended", onEnded);
  audio.addEventListener("error", onAudioError);

  void store.settings().then((settings) => {
    if (disposed) return;
    musicOn = settings.music;
    minutes = isMinutes(settings.lullabyMinutes) ? settings.lullabyMinutes : DEFAULT_MINUTES;
    if (!playing) remainingMs = minutes * 60_000;
    paint();
  });
  paint();

  return () => {
    disposed = true;
    try {
      release();
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onAudioError);
      graph?.source.disconnect();
      graph?.gain.disconnect();
    } finally {
      graph = null;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("ryzhik:background", onPageHide);
      // Back, home, and any other route all come through this cleanup.
      sound.silence(false);
    }
  };
}
