import type { Settings } from "./storage";

/**
 * Sound and voice hooks. Nothing is played yet — the MVP ships silent, but every
 * call site already exists, so adding real audio later is a change in this file
 * only and does not touch the screens.
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

const LOUD: SoundEvent[] = ["fill", "done", "star"];

let flags = { music: true, sounds: true, voice: true };
let unlocked = false;

export const sound = {
  configure(settings: Settings): void {
    flags = { music: settings.music, sounds: settings.sounds, voice: settings.voice };
  },

  /** Browsers block audio until the first gesture; call this on any tap. */
  unlock(): void {
    unlocked = true;
  },

  play(event: SoundEvent): void {
    if (!flags.sounds || !unlocked) return;
    // TODO: play the 8-event sound map from docs/design.md (§4.2).
    // `LOUD` marks the events that need a real sample rather than a UI click.
    void LOUD.includes(event);
  },

  /** Short Ryzhik line. Silent while the voice toggle is off. */
  say(line: string): void {
    if (!flags.voice || !unlocked) return;
    // TODO: play the recorded line; `line` is the key of the phrase.
    void line;
  },
};
