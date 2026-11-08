import type { Settings } from "./storage";

/**
 * Short synthesized cues. Screens already call `play`; nothing here is loaded
 * from a file. Audio starts only after a user gesture (`unlock`), and every
 * call stays silent while the sound toggle is off.
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
  | "star";

let flags = { music: true, sounds: true, voice: true };
let unlocked = false;
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let lastStroke = 0;

function audioCtor(): typeof AudioContext | undefined {
  if (typeof window.AudioContext === "function") return window.AudioContext;
  const legacy = (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return typeof legacy === "function" ? legacy : undefined;
}

/** Created from `unlock`, which runs inside the gesture. Later cues reuse it. */
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

function playTone(freq: number, type: OscillatorType, duration: number, vol = 0.1): void {
  const c = ctx;
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  const now = c.currentTime;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(vol, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(now);
  osc.stop(now + duration);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}

/** Fill: a short descending "bloop", not a held low tone. */
function playBloop(): void {
  const c = ctx;
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  const now = c.currentTime;
  osc.type = "sine";
  osc.frequency.setValueAtTime(420, now);
  osc.frequency.exponentialRampToValueAtTime(150, now + 0.16);
  gain.gain.setValueAtTime(0.09, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.2);
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

function playReward(): void {
  const c = ctx;
  if (!c) return;
  const now = c.currentTime;
  const notes = [440, 554, 659, 880];
  notes.forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    const start = now + i * 0.16;
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.08, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(start);
    osc.stop(start + 0.22);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  });
}

export const sound = {
  configure(settings: Settings): void {
    flags = { music: settings.music, sounds: settings.sounds, voice: settings.voice };
  },

  /** Browsers block audio until the first gesture; call this on any tap. */
  unlock(): void {
    unlocked = true;
    const c = ensureContext();
    if (c && c.state === "suspended") void c.resume().catch(() => undefined);
  },

  play(event: SoundEvent): void {
    if (!flags.sounds || !unlocked) return;
    const c = ensureContext();
    if (!c) return;
    if (c.state === "suspended") void c.resume().catch(() => undefined);
    try {
      switch (event) {
        case "tap":
        case "tool":
          playTone(600, "sine", 0.05, 0.05);
          break;
        case "fill":
          playBloop();
          break;
        case "stroke":
          playBrush();
          break;
        case "done":
        case "star":
          playReward();
          break;
        default:
          break;
      }
    } catch {
      /* A missing or blocked audio device must not break a tap. */
    }
  },

  /** Short Ryzhik line. Silent while the voice toggle is off. No samples yet. */
  say(line: string): void {
    if (!flags.voice || !unlocked) return;
    void line;
  },
};
