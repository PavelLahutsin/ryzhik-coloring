import type { Settings } from "./storage";
import fillUrl from "./assets/audio/zvuk_1_fill.mp3";
import colorUrl from "./assets/audio/zvuk_2_color.mp3";
import doneUrl from "./assets/audio/zvuk_3_done.mp3";
import undoUrl from "./assets/audio/zvuk_4_undo.mp3";
import albumUrl from "./assets/audio/zvuk_5_album.mp3";
import stickerUrl from "./assets/audio/zvuk_6_sticker.mp3";
import lockedUrl from "./assets/audio/zvuk_7_locked.mp3";
import phrase1 from "./assets/audio/fraza_1.mp3";
import phrase2 from "./assets/audio/fraza_2.mp3";
import phrase3 from "./assets/audio/fraza_3.mp3";
import phrase4 from "./assets/audio/fraza_4.mp3";
import phrase5 from "./assets/audio/fraza_5.mp3";
import phrase6 from "./assets/audio/fraza_6.mp3";
import phrase7 from "./assets/audio/fraza_7.mp3";
import phrase8 from "./assets/audio/fraza_8.mp3";

/**
 * Local clips only. Effects are quieter than Ryzhik's voice, two phrases never
 * play at once, and nothing starts until the first tap (iOS will not play
 * sooner). A missing clip never blocks a tap.
 */
export type SoundEvent =
  | "tap"
  | "fill"
  | "stroke"
  | "miss"
  | "tool"
  | "magnet"
  | "undo"
  | "clear"
  | "done"
  | "star"
  | "color"
  | "album"
  | "sticker"
  | "locked";

export type PhraseId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const SFX_GAIN = 0.22;
const VOICE_GAIN = 0.85;
const OCCASIONAL_GAP_MS = 20_000;

const SFX: Partial<Record<SoundEvent, string>> = {
  fill: fillUrl,
  color: colorUrl,
  done: doneUrl,
  star: doneUrl,
  undo: undoUrl,
  album: albumUrl,
  sticker: stickerUrl,
  miss: lockedUrl,
  locked: lockedUrl,
};

const PHRASES: Record<PhraseId, string> = {
  1: phrase1,
  2: phrase2,
  3: phrase3,
  4: phrase4,
  5: phrase5,
  6: phrase6,
  7: phrase7,
  8: phrase8,
};

let flags = { music: true, sounds: true, voice: true };
let unlocked = false;
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let lastStroke = 0;
let greeted = false;
let colorPicked = false;
let painted = false;
let phrase: AudioBufferSourceNode | null = null;
let lastOccasional = 0;
/** Set by screens that must stay silent (lullabies): no effects, no phrases. */
let silenced = false;
const clips = new Map<string, AudioBuffer>();
const raw = new Map<string, ArrayBuffer>();
const playing = new Set<AudioBufferSourceNode>();

function audioCtor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  if (typeof window.AudioContext === "function") return window.AudioContext;
  const legacy = (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return typeof legacy === "function" ? legacy : undefined;
}

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = audioCtor();
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

let fetching: Promise<void> | null = null;

function fetchClips(): Promise<void> {
  if (typeof fetch !== "function") return Promise.resolve();
  fetching ??= (async () => {
    const files: [string, string][] = [
      ...Object.entries(SFX).filter((entry): entry is [string, string] => Boolean(entry[1])),
      ...(Object.entries(PHRASES) as [string, string][]),
    ];
    await Promise.all(
      files.map(async ([key, url]) => {
        try {
          const response = await fetch(url);
          if (!response.ok) return;
          raw.set(key, await response.arrayBuffer());
        } catch {
          /* A missing file stays silent. */
        }
      }),
    );
  })();
  return fetching;
}

let decoding: Promise<void> | null = null;
let decoded = false;

function decodeClips(): Promise<void> {
  const c = ensureContext();
  if (!c) return Promise.resolve();
  decoding ??= (async () => {
    await fetchClips();
    await Promise.all(
      [...raw.entries()].map(async ([key, data]) => {
        if (clips.has(key)) return;
        try {
          clips.set(key, await c.decodeAudioData(data.slice(0)));
        } catch {
          /* Skip a clip the device cannot decode. */
        }
      }),
    );
    decoded = true;
  })();
  return decoding;
}

function startClip(buffer: AudioBuffer, gainValue: number, asPhrase: boolean): AudioBufferSourceNode | null {
  const c = ctx;
  if (!c) return null;
  const source = c.createBufferSource();
  source.buffer = buffer;
  const gain = c.createGain();
  gain.gain.setValueAtTime(gainValue, c.currentTime);
  source.connect(gain);
  gain.connect(c.destination);
  playing.add(source);
  if (asPhrase) phrase = source;
  source.onended = () => {
    playing.delete(source);
    if (phrase === source) phrase = null;
    source.disconnect();
    gain.disconnect();
  };
  try {
    source.start();
  } catch {
    playing.delete(source);
    if (phrase === source) phrase = null;
    return null;
  }
  return source;
}

function playKey(key: string, gainValue: number): void {
  const buffer = clips.get(key);
  if (!buffer) {
    if (decoded) return;
    void decodeClips().then(() => {
      const ready = clips.get(key);
      if (ready && flags.sounds && unlocked) startClip(ready, gainValue, false);
    });
    return;
  }
  startClip(buffer, gainValue, false);
}

function playTone(freq: number, duration: number, vol = 0.05): void {
  const c = ctx;
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  const now = c.currentTime;
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(vol, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}

function playBrush(): void {
  const c = ctx;
  if (!c) return;
  const nowMs = performance.now();
  if (nowMs - lastStroke < 80) return;
  lastStroke = nowMs;
  if (!noise || noise.sampleRate !== c.sampleRate) {
    const length = Math.floor(c.sampleRate * 0.08);
    const buffer = c.createBuffer(1, length, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise = buffer;
  }
  const source = c.createBufferSource();
  source.buffer = noise;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.012, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.08);
  source.connect(gain);
  gain.connect(c.destination);
  source.start();
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
  };
}

/** @param interrupt Replace a phrase that is already speaking. */
function say(id: PhraseId, then?: () => void, interrupt = false): void {
  if (!flags.voice || !unlocked || silenced) return;
  if (phrase && !interrupt) return;
  const buffer = clips.get(String(id));
  if (!buffer) {
    if (decoded) return;
    void decodeClips().then(() => {
      if (clips.get(String(id))) say(id, then, interrupt);
    });
    return;
  }
  if (interrupt) stopPhrase();
  const source = startClip(buffer, VOICE_GAIN, true);
  if (!source) return;
  const previous = source.onended;
  source.onended = (event) => {
    previous?.call(source, event);
    if (phrase === source) phrase = null;
    then?.();
  };
}

function stopPhrase(): void {
  if (!phrase) return;
  const current = phrase;
  phrase = null;
  current.onended = null;
  try {
    current.stop();
  } catch {
    /* Already finished. */
  }
  playing.delete(current);
}

function maybeSay(id: PhraseId, chance = 0.45): void {
  if (phrase) return;
  const now = performance.now();
  if (now - lastOccasional < OCCASIONAL_GAP_MS) return;
  if (Math.random() > chance) return;
  say(id);
}

let wantWelcome = false;

function welcome(): void {
  // A lullaby screen (or a clip that is not decoded yet) must not use up the
  // one greeting. greeted flips only after phrase 1 has actually started.
  if (!wantWelcome || greeted || !flags.voice || !unlocked || silenced) return;
  if (!clips.has("1") || phrase) return;
  say(1, () => {
    if (!silenced && !painted && !colorPicked) maybeSay(2, 0.5);
  });
  if (!phrase) return;
  greeted = true;
  wantWelcome = false;
}

if (typeof document !== "undefined") {
  void fetchClips();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") sound.stop();
  });
  window.addEventListener("pagehide", () => sound.stop());
  window.addEventListener("ryzhik:background", () => {
    sound.stop();
    document.querySelectorAll("audio").forEach((node) => {
      if (node instanceof HTMLAudioElement) node.pause();
    });
    if (ctx && ctx.state === "running") void ctx.suspend().catch(() => undefined);
  });
}

export const sound = {
  configure(settings: Settings): void {
    flags = { music: settings.music, sounds: settings.sounds, voice: settings.voice };
    if (!flags.voice) stopPhrase();
  },

  /** Browsers block audio until the first gesture; call this on any tap. */
  unlock(): void {
    unlocked = true;
    const c = ensureContext();
    if (!c) return;
    if (c.state === "suspended") void c.resume().catch(() => undefined);
    try {
      const silence = c.createBuffer(1, 1, c.sampleRate);
      const source = c.createBufferSource();
      source.buffer = silence;
      source.connect(c.destination);
      source.start();
    } catch {
      /* The resume above is enough on browsers that reject a silent buffer. */
    }
    void decodeClips().then(() => welcome());
  },

  play(event: SoundEvent): void {
    if (!flags.sounds || !unlocked || silenced) return;
    const c = ensureContext();
    if (!c) return;
    if (c.state === "suspended") void c.resume().catch(() => undefined);
    try {
      const file = SFX[event];
      if (file) {
        playKey(event, SFX_GAIN);
        return;
      }
      switch (event) {
        case "tap":
        case "tool":
        case "magnet":
        case "clear":
          playTone(620, 0.05, 0.04);
          break;
        case "stroke":
          playBrush();
          break;
        default:
          break;
      }
    } catch {
      /* A missing or blocked audio device must not break a tap. */
    }
  },

  /** First visit to a colouring page this session. Phrase 1, then maybe 2. */
  enterColoring(alreadyPainted: boolean): void {
    if (alreadyPainted) painted = true;
    wantWelcome = !greeted;
    if (greeted && !painted && !colorPicked) maybeSay(2, 0.4);
    welcome();
  },

  noteColor(): void {
    colorPicked = true;
  },

  /** After a fill: phrase 3 or 5, not more than once per 20 seconds. */
  noteFill(): void {
    painted = true;
    maybeSay(Math.random() < 0.5 ? 3 : 5);
  },

  noteUndo(): void {
    maybeSay(7, 0.4);
  },

  /** «Готово»: the reward chime is played by the caller; then phrase 4, then 6. */
  praise(): void {
    say(4, () => say(6), true);
  },

  /** Home after the child has actually painted. */
  goodbye(): void {
    if (!painted) return;
    say(8, undefined, true);
  },

  /** Shared AudioContext for long tracks (lullabies). Null before the first unlock. */
  context(): AudioContext | null {
    return ctx;
  },

  /** Silences effects and phrases until released. Also stops anything playing now. */
  silence(on: boolean): void {
    silenced = on;
    if (on) this.stop();
    else welcome();
  },

  stop(): void {
    stopPhrase();
    for (const source of playing) {
      try {
        source.stop();
      } catch {
        /* Already finished. */
      }
    }
    playing.clear();
  },
};
