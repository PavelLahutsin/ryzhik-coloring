/**
 * Icon set: 24×24 grid, rounded caps, thick strokes. Tools are drawn as
 * objects (bucket, marker, pencil, crayon, eraser) because a 4-year-old recognises a thing,
 * not a metaphor.
 */
export type IconName =
  | "back"
  | "home"
  | "undo"
  | "redo"
  | "check"
  | "bucket"
  | "brush"
  | "marker"
  | "pencil"
  | "crayon"
  | "eraser"
  | "clear"
  | "magnet"
  | "magnetOff"
  | "star"
  | "picture"
  | "lock"
  | "sound"
  | "music"
  | "voice"
  | "chevronLeft"
  | "chevronRight"
  | "fit"
  | "close"
  | "play"
  | "pause"
  | "moon";

const PATHS: Record<IconName, string> = {
  back: '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
  home: '<path d="M4 10.6 12 4l8 6.6V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
  undo: '<path d="M8 8 3 13l5 5"/><path d="M3 13h9.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m16 8 5 5-5 5"/><path d="M21 13h-9.5a5.5 5.5 0 0 0 0 11H13"/>',
  check: '<path d="m5 13 5 5L19 7"/>',
  bucket:
    '<path d="M4.6 11.4 11 5l7.4 7.4-6.4 6.4a2 2 0 0 1-2.8 0l-4.6-4.6a2 2 0 0 1 0-2.8Z"/>' +
    '<path d="M8.2 8.6 5.4 5.8"/>' +
    '<path class="icon__drop" d="M19 12.6c1.6 2 2.4 3.3 2.4 4.3a2.4 2.4 0 0 1-4.8 0c0-1 .8-2.3 2.4-4.3Z"/>',
  brush:
    '<path d="M4.4 19.6c2.5.6 4.6-.6 5.7-2.4l7.6-8.1-3.1-3.1-8.1 7.6c-1.8 1.1-3 3.2-2.4 5.7Z"/>' +
    '<path d="M14.6 5.9 18.1 2.4"/>',
  marker:
    '<path d="M7.2 20.6 15.4 8.8l3 3.2-8.2 11.8a1.8 1.8 0 0 1-2.6.2l-0.6-0.7a1.8 1.8 0 0 1 .2-2.7Z"/>' +
    '<path d="M15.4 8.8 18.2 4.6l3.2 2.2-2.6 4.2"/>' +
    '<path d="M8.6 18.4 17 10.6"/>',
  pencil:
    '<path d="M4.4 19.6 14.6 9.4l2.8 2.8-10.2 10.2-3 .2.2-3Z"/>' +
    '<path d="M14.6 9.4 17.8 6.2l2.8 2.8-3.2 3.2"/>' +
    '<path d="M17.8 6.2 20.2 3.8 22 5.6 19.6 8"/>' +
    '<path d="M6.2 17.8 8.8 20.4"/>',
  crayon:
    '<path d="M6.2 19.6 13.4 12.4l3.4 3.4-7.2 7.2a1.6 1.6 0 0 1-2.3 0L6.2 19.6z"/>' +
    '<path d="M13.4 12.4 16.8 9l3.4 3.4-3.4 3.4"/>' +
    '<path d="M16.8 9 19 6.8 21.2 9 19 11.2"/>' +
    '<path d="M12.2 13.6 15.6 17"/>',
  eraser:
    '<path d="M9 20h11"/>' +
    '<path d="M6.6 13.6 13.2 7a1.8 1.8 0 0 1 2.6 0l2.6 2.6a1.8 1.8 0 0 1 0 2.6L14 18.8a1.8 1.8 0 0 1-2.6 0l-4.8-2.6a1.8 1.8 0 0 1 0-2.6Z"/>',
  clear:
    '<path d="M6.5 4h7.5L18 8v11a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/>' +
    '<path d="M13.8 4v4.2H18"/>' +
    '<path d="m9.4 12.4 5 5"/><path d="m14.4 12.4-5 5"/>',
  magnet:
    '<path d="M7 4v9a5 5 0 0 0 10 0V4"/><path d="M7 9.4h3.4"/><path d="M13.6 9.4H17"/>' +
    '<path d="M7 4h3.4"/><path d="M13.6 4H17"/>',
  magnetOff: '<path d="M7 4v9a5 5 0 0 0 10 0V4"/><path d="M4 4l16 16"/>',
  star: '<path d="m12 3.6 2.7 5.6 6.2.9-4.5 4.3 1.1 6.1-5.5-3-5.5 3 1.1-6.1L3.1 10l6.2-.9Z"/>',
  picture:
    '<rect x="3.5" y="5" width="17" height="14" rx="2.6"/>' +
    '<path d="m4.4 16.2 4.6-4.6 3.4 3.4 2.6-2.6 4.6 4.6"/>' +
    '<circle cx="9" cy="10" r="1.4"/>',
  lock: '<rect x="5" y="10.4" width="14" height="10.2" rx="2.6"/><path d="M8.6 10.4V8a3.4 3.4 0 0 1 6.8 0v2.4"/>',
  sound: '<path d="M4 9.6v4.8h3l4 3.6V6L7 9.6z"/><path d="M15.2 9.2a4 4 0 0 1 0 5.6"/><path d="M17.8 6.6a7.6 7.6 0 0 1 0 10.8"/>',
  music: '<path d="M9.4 17.4V6.2l8.6-2v11.2"/><circle cx="7.2" cy="18" r="2.2"/><circle cx="15.8" cy="16.4" r="2.2"/>',
  voice:
    '<path d="M4.6 6h14.8A1.6 1.6 0 0 1 21 7.6v6.8a1.6 1.6 0 0 1-1.6 1.6H11l-4.4 3.8V16H4.6A1.6 1.6 0 0 1 3 14.4V7.6A1.6 1.6 0 0 1 4.6 6Z"/>',
  chevronLeft: '<path d="M14.5 6 8.5 12l6 6"/>',
  chevronRight: '<path d="M9.5 6l6 6-6 6"/>',
  /** Four corners pointing out: "the whole picture again". */
  fit:
    '<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>' +
    '<rect x="8.5" y="8.5" width="7" height="7" rx="1.6"/>',
  close: '<path d="m6 6 12 12"/><path d="M18 6 6 18"/>',
  play: '<path d="M8 5.6v12.8a1 1 0 0 0 1.5.9l10.4-6.4a1 1 0 0 0 0-1.8L9.5 4.7A1 1 0 0 0 8 5.6Z"/>',
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1.4"/><rect x="13.5" y="5" width="4" height="14" rx="1.4"/>',
  /** Crescent moon: the lullaby entrance on the menu. */
  moon: '<path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1Z"/>',
};

export function icon(name: IconName, size = 28, extraClass?: string): SVGSVGElement {
  const template = document.createElement("template");
  template.innerHTML =
    `<svg class="icon${extraClass ? ` ${extraClass}` : ""}" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" ` +
    `aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
  return template.content.firstElementChild as SVGSVGElement;
}
