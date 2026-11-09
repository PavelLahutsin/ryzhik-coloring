import { REGION_RASTER_WIDTH, buildRegionLabels, nearestLabel, paintLabel } from "./regions";

export type Tool = "fill" | "pencil" | "brush" | "marker" | "eraser";

const TARGET_WIDTH = REGION_RASTER_WIDTH;
/** Design doc: undo/redo stack of 30 steps. */
const HISTORY_LIMIT = 30;
/** Pixels darker than this are the line art, not empty paper. */
const INK_ALPHA = 72;
/** Pinch zoom range. 1 is "the whole picture fits". */
const MAX_ZOOM = 5;
/** A finger that moved less than this (CSS px) still counts as a tap. */
const TAP_SLOP = 14;

type Rgb = { r: number; g: number; b: number };
type Layer = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };

/** How much of the paintable area carries paint. Used by S5 and album dots. */
export type PaintProgress = { painted: number; total: number; ratio: number };

function makeCanvas(w: number, h: number, read: boolean): Layer {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: read });
  if (!ctx) throw new Error("canvas");
  return { canvas, ctx };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(url));
    image.src = url;
  });
}

function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function reset(ctx: CanvasRenderingContext2D): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

/**
 * Paint sits on its own layer. Black outlines are a second layer drawn
 * last, so a stroke can never cover the line art.
 * With "Не выходить за линии" a stroke is masked to the region under
 * the finger where the stroke began.
 */
export class ColoringBook {
  private w = 0;
  private h = 0;
  private labels: Uint32Array<ArrayBufferLike> = new Uint32Array();
  private tool: Tool = "fill";
  private color = "#ff8a3d";
  private rgb: Rgb = hexToRgb(this.color);
  private sizeCss = 22;
  private clipOn = true;
  private ready = false;

  private paint!: Layer;
  private stroke!: Layer;
  private lines!: Layer;
  private flat!: Layer;
  private scratch!: Layer;
  private viewCtx: CanvasRenderingContext2D;
  private clipCanvas: HTMLCanvasElement | null = null;
  private clipLabel = 0;

  private undoStack: ImageData[] = [];
  private redoStack: ImageData[] = [];
  private pointerId: number | null = null;
  private stroking = false;
  private hasDab = false;
  private downCss = { x: 0, y: 0 };
  private last: { x: number; y: number } | null = null;

  /** Every finger currently on the sheet, by pointer id, in client px. */
  private pointers = new Map<number, { x: number; y: number }>();
  /** Set once a second finger lands; cleared when the last finger lifts.
   *  While set nothing paints, so a pinch can never turn into a fill. */
  private gesturing = false;
  /** One-finger drag of a zoomed picture with the fill tool. */
  private panning = false;
  private zoom = { scale: 1, x: 0, y: 0 };
  private pinchStart: {
    dist: number;
    mid: { x: number; y: number };
    zoom: { scale: number; x: number; y: number };
  } | null = null;
  private panStart: { x: number; y: number; zx: number; zy: number } | null = null;
  private surface: HTMLElement;

  onHistory: (() => void) | null = null;
  /** Fired after a fill or a finished stroke, with the picture progress. */
  onPaint: ((progress: PaintProgress) => void) | null = null;
  /** UI-only. A finished fill, or a dab that is not the eraser. */
  onSound: ((event: "fill" | "stroke") => void) | null = null;
  /** True while the picture is zoomed in, so the screen can show "reset". */
  onZoom: ((zoomed: boolean) => void) | null = null;

  constructor(
    private view: HTMLCanvasElement,
    private stage: HTMLElement,
  ) {
    const ctx = view.getContext("2d");
    if (!ctx) throw new Error("canvas");
    this.viewCtx = ctx;
    // Pointers are read on the frame around the sheet, not on the sheet
    // itself: the second finger of a pinch often lands next to the picture.
    const box = stage.parentElement ?? stage;
    this.surface = box;
    box.addEventListener("pointerdown", this.onPointerDown, { passive: false });
    box.addEventListener("pointermove", this.onPointerMove, { passive: false });
    box.addEventListener("pointerup", this.onPointerUp);
    box.addEventListener("pointercancel", this.onPointerCancel);
    box.addEventListener("wheel", this.onWheel, { passive: false });
    box.addEventListener("contextmenu", (event) => event.preventDefault());
    new ResizeObserver(() => {
      this.layout();
      this.resetZoom();
    }).observe(box);
  }

  /** A finger is down: autosave waits, so it never cuts a line in half. */
  get busy(): boolean {
    return this.stroking || this.pointers.size > 0;
  }

  get zoomed(): boolean {
    return this.zoom.scale > 1.01;
  }

  /** "Вернуть как было": the whole picture, centred, no zoom. */
  resetZoom(): void {
    this.zoom = { scale: 1, x: 0, y: 0 };
    this.applyZoom();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  setTool(tool: Tool): void {
    if (this.stroking) this.finishStroke();
    this.tool = tool;
  }

  setColor(hex: string): void {
    this.color = hex;
    this.rgb = hexToRgb(hex);
  }

  setSize(cssDiameter: number): void {
    this.sizeCss = Math.max(2, cssDiameter);
  }

  setClip(on: boolean): void {
    this.clipOn = on;
    if (!on) {
      this.clipCanvas = null;
      this.clipLabel = 0;
    }
  }

  async load(svgUrl: string, pngUrl: string): Promise<void> {
    const source = await this.pickSource(svgUrl, pngUrl);
    const naturalW = source.image.naturalWidth || 2560;
    const naturalH = source.image.naturalHeight || 1440;
    this.w = TARGET_WIDTH;
    this.h = Math.max(1, Math.round((TARGET_WIDTH * naturalH) / naturalW));

    this.view.width = this.w;
    this.view.height = this.h;
    this.paint = makeCanvas(this.w, this.h, true);
    this.stroke = makeCanvas(this.w, this.h, false);
    this.lines = makeCanvas(this.w, this.h, true);
    this.flat = makeCanvas(this.w, this.h, false);
    this.scratch = makeCanvas(this.w, this.h, false);

    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    this.drawLines(source.image, source.keyWhite);
    let alpha = this.readAlpha();
    const ink = alpha.reduce((sum, value) => sum + (value > INK_ALPHA ? 1 : 0), 0) / alpha.length;
    if (ink > 0.45 && !source.keyWhite) {
      const png = await loadImage(pngUrl);
      this.drawLines(png, true);
      alpha = this.readAlpha();
    }
    this.labels = buildRegionLabels(alpha, this.w, this.h);

    this.ready = true;
    this.layout();
    this.render();
  }

  undo(): void {
    if (!this.ready || this.undoStack.length === 0) return;
    if (this.stroking) this.finishStroke();
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.paint.ctx.getImageData(0, 0, this.w, this.h));
    this.paint.ctx.putImageData(previous, 0, 0);
    this.render();
    this.emit();
    this.emitPaint();
  }

  redo(): void {
    if (!this.ready || this.redoStack.length === 0) return;
    if (this.stroking) this.finishStroke();
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.paint.ctx.getImageData(0, 0, this.w, this.h));
    this.paint.ctx.putImageData(next, 0, 0);
    this.render();
    this.emit();
    this.emitPaint();
  }

  /** Commits an in-progress stroke. Autosave calls this so a draft never
   *  misses the line the child is drawing at that moment. */
  flush(): void {
    if (this.stroking) this.finishStroke();
  }

  /** True when there is paint to erase or undo back to. */
  hasPaint(): boolean {
    return this.ready && this.paintHasInk();
  }

  clear(): boolean {
    if (!this.hasPaint()) return false;
    if (this.stroking) this.finishStroke();
    this.pushUndo();
    reset(this.paint.ctx);
    this.paint.ctx.clearRect(0, 0, this.w, this.h);
    this.render();
    this.emitPaint();
    return true;
  }

  async save(filename: string): Promise<boolean> {
    if (!this.ready) return false;
    if (this.stroking) this.finishStroke();
    this.render();
    const blob = await this.exportBlob();
    if (!blob) return false;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  }

  /** Flattened PNG of the whole sheet: paper, paint, line art. */
  async exportBlob(): Promise<Blob | null> {
    if (!this.ready) return null;
    if (this.stroking) this.finishStroke();
    this.render();
    return new Promise<Blob | null>((resolve) => {
      this.view.toBlob(resolve, "image/png");
    });
  }

  /** Flattened PNG scaled down to `maxSide`, for the gallery and the reward screen. */
  async exportDataUrl(maxSide = 1280): Promise<string | null> {
    if (!this.ready) return null;
    if (this.stroking) this.finishStroke();
    this.render();
    const scale = Math.min(1, maxSide / Math.max(this.w, this.h));
    if (scale >= 1) return this.view.toDataURL("image/png");
    const target = makeCanvas(Math.round(this.w * scale), Math.round(this.h * scale), false);
    target.ctx.imageSmoothingEnabled = true;
    target.ctx.imageSmoothingQuality = "high";
    target.ctx.drawImage(this.view, 0, 0, target.canvas.width, target.canvas.height);
    return target.canvas.toDataURL("image/png");
  }

  /**
   * Paint layer as a PNG data URL. Only the paint, not the line art: a draft
   * stays small and survives a change of picture assets.
   */
  snapshot(): string | null {
    if (!this.ready || !this.hasPaint()) return null;
    return this.paint.canvas.toDataURL("image/png");
  }

  /** Restores a draft produced by `snapshot`. Lines stay untouched. */
  async restore(dataUrl: string): Promise<void> {
    if (!this.ready || !dataUrl) return;
    const image = await loadImage(dataUrl).catch(() => null);
    if (!image) return;
    reset(this.paint.ctx);
    this.paint.ctx.clearRect(0, 0, this.w, this.h);
    this.paint.ctx.drawImage(image, 0, 0, this.w, this.h);
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.render();
    this.emit();
    this.emitPaint();
  }

  /**
   * Restores paint from a flattened gallery PNG (older entries kept no paint
   * layer). Paper white and the line pixels are dropped, the colour stays.
   */
  async restoreFlattened(dataUrl: string): Promise<void> {
    if (!this.ready || !dataUrl) return;
    const image = await loadImage(dataUrl).catch(() => null);
    if (!image) return;
    const ctx = this.scratch.ctx;
    reset(ctx);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.drawImage(image, 0, 0, this.w, this.h);
    const pixels = ctx.getImageData(0, 0, this.w, this.h);
    const data = pixels.data;
    for (let i = 0, p = 0; i < this.labels.length; i++, p += 4) {
      const paper = data[p] > 240 && data[p + 1] > 240 && data[p + 2] > 240;
      if (this.labels[i] === 0 || paper) data[p + 3] = 0;
      else data[p + 3] = 255;
    }
    ctx.clearRect(0, 0, this.w, this.h);
    reset(this.paint.ctx);
    this.paint.ctx.clearRect(0, 0, this.w, this.h);
    this.paint.ctx.putImageData(pixels, 0, 0);
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.render();
    this.emit();
    this.emitPaint();
  }

  /** Share of the paintable area that carries paint, 0..1. */
  progress(): PaintProgress {
    if (!this.ready) return { painted: 0, total: 0, ratio: 0 };
    const data = this.paint.ctx.getImageData(0, 0, this.w, this.h).data;
    let total = 0;
    let painted = 0;
    for (let i = 0; i < this.labels.length; i++) {
      if (!this.labels[i]) continue;
      total++;
      if (data[i * 4 + 3] !== 0) painted++;
    }
    return { painted, total, ratio: total ? painted / total : 0 };
  }

  get aspect(): number {
    return this.h ? this.w / this.h : 1;
  }

  private async pickSource(svgUrl: string, pngUrl: string): Promise<{ image: HTMLImageElement; keyWhite: boolean }> {
    try {
      const image = await loadImage(svgUrl);
      if (image.naturalWidth > 0) return { image, keyWhite: false };
    } catch {
      /* The traced SVG is the page; the original raster is the fallback. */
    }
    return { image: await loadImage(pngUrl), keyWhite: true };
  }

  private drawLines(image: CanvasImageSource, keyWhite: boolean): void {
    reset(this.lines.ctx);
    this.lines.ctx.clearRect(0, 0, this.w, this.h);
    this.lines.ctx.imageSmoothingEnabled = true;
    this.lines.ctx.imageSmoothingQuality = "high";
    this.lines.ctx.drawImage(image, 0, 0, this.w, this.h);
    if (!keyWhite) return;

    const pixels = this.lines.ctx.getImageData(0, 0, this.w, this.h);
    const data = pixels.data;
    for (let i = 0; i < data.length; i += 4) {
      const shade = data[i];
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = shade > 248 ? 0 : 255 - shade;
    }
    this.lines.ctx.putImageData(pixels, 0, 0);
  }

  private readAlpha(): Uint8Array {
    const pixels = this.lines.ctx.getImageData(0, 0, this.w, this.h).data;
    const alpha = new Uint8Array(this.w * this.h);
    for (let i = 0, p = 3; i < alpha.length; i++, p += 4) alpha[i] = pixels[p];
    return alpha;
  }

  private emit(): void {
    this.onHistory?.();
  }

  private emitPaint(): void {
    if (!this.onPaint) return;
    this.onPaint(this.progress());
  }

  private cue(event: "fill" | "stroke"): void {
    try {
      this.onSound?.(event);
    } catch {
      /* Sound never blocks painting. */
    }
  }

  private pushUndo(): void {
    this.redoStack.length = 0;
    this.undoStack.push(this.paint.ctx.getImageData(0, 0, this.w, this.h));
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.emit();
  }

  private paintHasInk(): boolean {
    const data = this.paint.ctx.getImageData(0, 0, this.w, this.h).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return true;
    }
    return false;
  }

  private layout(): void {
    if (!this.w) return;
    const parent = this.stage.parentElement ?? this.stage;
    const style = getComputedStyle(parent);
    const padX = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
    const padY = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    const maxW = parent.clientWidth - padX;
    const maxH = parent.clientHeight - padY;
    if (maxW < 8 || maxH < 8) return;
    const aspect = this.w / this.h;
    let cssW = maxW;
    let cssH = cssW / aspect;
    if (cssH > maxH) {
      cssH = maxH;
      cssW = cssH * aspect;
    }
    this.stage.style.width = `${cssW}px`;
    this.stage.style.height = `${cssH}px`;
    this.view.style.width = "100%";
    this.view.style.height = "100%";
    this.view.style.left = "0";
    this.view.style.top = "0";
  }

  /** Keeps the zoomed picture covering its own box, so it cannot be lost. */
  private clampZoom(): void {
    const width = this.stage.offsetWidth;
    const height = this.stage.offsetHeight;
    const scale = Math.min(MAX_ZOOM, Math.max(1, this.zoom.scale));
    const minX = width - width * scale;
    const minY = height - height * scale;
    this.zoom = {
      scale,
      x: Math.min(0, Math.max(minX, this.zoom.x)),
      y: Math.min(0, Math.max(minY, this.zoom.y)),
    };
  }

  private applyZoom(): void {
    this.clampZoom();
    const { scale, x, y } = this.zoom;
    this.stage.style.transformOrigin = "0 0";
    this.stage.style.transform =
      scale > 1.001 ? `translate(${x}px, ${y}px) scale(${scale})` : "";
    this.onZoom?.(this.zoomed);
  }

  /** Zoom by `factor` keeping the client point (cx, cy) still. */
  private zoomAround(cx: number, cy: number, nextScale: number, base = this.zoom): void {
    const box = this.stageOrigin();
    const px = cx - box.x;
    const py = cy - box.y;
    const scale = Math.min(MAX_ZOOM, Math.max(1, nextScale));
    // Content point under the finger in unscaled stage px.
    const ux = (px - base.x) / base.scale;
    const uy = (py - base.y) / base.scale;
    this.zoom = { scale, x: px - ux * scale, y: py - uy * scale };
    this.applyZoom();
  }

  /** Client position of the stage's untransformed top-left corner. */
  private stageOrigin(): { x: number; y: number } {
    const rect = this.stage.getBoundingClientRect();
    return { x: rect.left - this.zoom.x, y: rect.top - this.zoom.y };
  }

  private cssScale(): number {
    const width = this.view.getBoundingClientRect().width;
    return width > 0 ? this.w / width : 1;
  }

  private bitmapRadius(): number {
    return Math.max(1, (this.sizeCss / 2) * this.cssScale());
  }

  private fingerRadius(): number {
    return Math.max(this.bitmapRadius(), 22 * this.cssScale());
  }

  private toolAlpha(): number {
    if (this.tool === "marker") return 0.62;
    return 1;
  }

  private render(): void {
    const flat = this.flat.ctx;
    reset(flat);
    flat.clearRect(0, 0, this.w, this.h);
    flat.drawImage(this.paint.canvas, 0, 0);
    if (this.stroking) {
      const stamp = this.maskedStroke();
      if (this.tool === "eraser") {
        flat.globalCompositeOperation = "destination-out";
        flat.drawImage(stamp, 0, 0);
      } else {
        flat.globalAlpha = this.toolAlpha();
        flat.drawImage(stamp, 0, 0);
      }
    }

    const view = this.viewCtx;
    reset(view);
    view.fillStyle = "#ffffff";
    view.fillRect(0, 0, this.w, this.h);
    view.drawImage(this.flat.canvas, 0, 0);
    view.drawImage(this.lines.canvas, 0, 0);
  }

  private maskedStroke(): HTMLCanvasElement {
    const ctx = this.scratch.ctx;
    reset(ctx);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.drawImage(this.stroke.canvas, 0, 0);
    if (this.clipOn && this.clipCanvas) {
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(this.clipCanvas, 0, 0);
    }
    return this.scratch.canvas;
  }

  private ensureClip(x: number, y: number): boolean {
    if (!this.clipOn) return true;
    const label = nearestLabel(this.labels, this.w, this.h, x, y, this.fingerRadius());
    if (!label) return false;
    if (this.clipLabel === label && this.clipCanvas) return true;
    this.clipLabel = label;
    const clip = this.clipCanvas ?? document.createElement("canvas");
    clip.width = this.w;
    clip.height = this.h;
    const ctx = clip.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    const image = ctx.createImageData(this.w, this.h);
    const data = image.data;
    for (let i = 0; i < this.labels.length; i++) {
      if (this.labels[i] !== label) continue;
      const p = i * 4;
      data[p] = 255;
      data[p + 1] = 255;
      data[p + 2] = 255;
      data[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    this.clipCanvas = clip;
    return true;
  }

  private dab(x: number, y: number): void {
    const radius = this.bitmapRadius();
    const ctx = this.stroke.ctx;
    reset(ctx);
    const { r, g, b } = this.rgb;
    if (this.tool === "brush") {
      const gradient = ctx.createRadialGradient(x, y, radius * 0.1, x, y, radius);
      gradient.addColorStop(0, `rgba(${r},${g},${b},1)`);
      gradient.addColorStop(0.55, `rgba(${r},${g},${b},0.9)`);
      gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = gradient;
    } else if (this.tool === "marker") {
      const gradient = ctx.createRadialGradient(x, y, radius * 0.72, x, y, radius);
      gradient.addColorStop(0, `rgba(${r},${g},${b},1)`);
      gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = gradient;
    } else if (this.tool === "eraser") {
      ctx.fillStyle = "#000000";
    } else {
      ctx.fillStyle = this.color;
    }
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    this.hasDab = true;
    if (this.tool !== "eraser") this.cue("stroke");
  }

  private strokeTo(x: number, y: number): void {
    if (!this.last) {
      this.dab(x, y);
      this.last = { x, y };
      return;
    }
    const dx = x - this.last.x;
    const dy = y - this.last.y;
    const distance = Math.hypot(dx, dy);
    const step = Math.max(1, this.bitmapRadius() * 0.22);
    const count = Math.ceil(distance / step);
    for (let i = 1; i <= count; i++) {
      this.dab(this.last.x + (dx * i) / count, this.last.y + (dy * i) / count);
    }
    this.last = { x, y };
  }

  private toBitmap(event: PointerEvent): { x: number; y: number } {
    const rect = this.view.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * this.w,
      y: ((event.clientY - rect.top) / rect.height) * this.h,
    };
  }

  private fillAt(x: number, y: number): void {
    const label = nearestLabel(this.labels, this.w, this.h, x, y, this.fingerRadius());
    if (!label) return;
    const image = this.paint.ctx.getImageData(0, 0, this.w, this.h);
    const changed = paintLabel(this.labels, label, image.data, this.rgb.r, this.rgb.g, this.rgb.b);
    if (!changed) return;
    this.pushUndo();
    this.paint.ctx.putImageData(image, 0, 0);
    this.render();
    this.emitPaint();
    this.cue("fill");
  }

  private finishStroke(): void {
    if (!this.stroking) return;
    this.stroking = false;
    if (this.hasDab) {
      this.pushUndo();
      const stamp = this.maskedStroke();
      const ctx = this.paint.ctx;
      reset(ctx);
      if (this.tool === "eraser") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.drawImage(stamp, 0, 0);
      } else {
        ctx.globalAlpha = this.toolAlpha();
        ctx.drawImage(stamp, 0, 0);
      }
    }
    reset(this.stroke.ctx);
    this.stroke.ctx.clearRect(0, 0, this.w, this.h);
    this.last = null;
    this.hasDab = false;
    this.render();
    this.emitPaint();
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.ready) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      this.surface.setPointerCapture(event.pointerId);
    } catch {
      /* The pointer can already be gone on a quick tap. */
    }

    if (this.pointers.size >= 2) {
      // Second finger: this is a pinch, never paint. Drop the stroke that the
      // first finger may have started; it was not committed yet.
      this.cancelStroke();
      this.pointerId = null;
      this.panning = false;
      this.panStart = null;
      this.gesturing = true;
      this.startPinch();
      return;
    }
    if (this.gesturing) return;

    this.pointerId = event.pointerId;
    this.downCss = { x: event.clientX, y: event.clientY };
    if (this.tool === "fill") return;

    const point = this.toBitmap(event);
    if (!this.ensureClip(point.x, point.y)) return;
    this.stroking = true;
    this.hasDab = false;
    this.last = null;
    this.strokeTo(point.x, point.y);
    this.render();
  };

  private onPointerMove = (event: PointerEvent): void => {
    const known = this.pointers.get(event.pointerId);
    if (!known) return;
    event.preventDefault();
    known.x = event.clientX;
    known.y = event.clientY;

    if (this.gesturing) {
      if (this.pointers.size >= 2) this.movePinch();
      return;
    }
    if (event.pointerId !== this.pointerId) return;

    if (this.tool === "fill") {
      // A zoomed picture can be dragged with one finger: a fill is a tap,
      // so a drag is free for moving the picture around.
      const moved = Math.hypot(event.clientX - this.downCss.x, event.clientY - this.downCss.y);
      if (!this.panning && this.zoomed && moved >= TAP_SLOP) {
        this.panning = true;
        this.panStart = { x: event.clientX, y: event.clientY, zx: this.zoom.x, zy: this.zoom.y };
      }
      if (this.panning && this.panStart) {
        this.zoom = {
          scale: this.zoom.scale,
          x: this.panStart.zx + (event.clientX - this.panStart.x),
          y: this.panStart.zy + (event.clientY - this.panStart.y),
        };
        this.applyZoom();
      }
      return;
    }

    if (!this.stroking) return;
    const points = event.getCoalescedEvents?.() ?? [event];
    for (const point of points) {
      const bitmap = this.toBitmap(point);
      this.strokeTo(bitmap.x, bitmap.y);
    }
    this.render();
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.delete(event.pointerId);

    if (this.gesturing) {
      if (this.pointers.size >= 2) this.startPinch();
      else this.pinchStart = null;
      // Stay in gesture mode until every finger is up: the finger that is
      // left after a pinch must not fill on release.
      if (this.pointers.size === 0) this.gesturing = false;
      return;
    }
    if (event.pointerId !== this.pointerId) return;
    this.pointerId = null;

    if (this.tool === "fill") {
      const wasPanning = this.panning;
      this.panning = false;
      this.panStart = null;
      if (wasPanning) return;
      const moved = Math.hypot(event.clientX - this.downCss.x, event.clientY - this.downCss.y);
      if (moved < TAP_SLOP) {
        const point = this.toBitmap(event);
        this.fillAt(point.x, point.y);
      }
      return;
    }
    this.finishStroke();
  };

  private onPointerCancel = (event: PointerEvent): void => {
    if (!this.pointers.has(event.pointerId)) return;
    // The system took the touch (an edge swipe, a call). Keep what was drawn
    // so far, never fill.
    if (!this.gesturing && event.pointerId === this.pointerId && this.tool !== "fill") {
      this.pointers.delete(event.pointerId);
      this.pointerId = null;
      this.finishStroke();
      return;
    }
    this.pointers.delete(event.pointerId);
    if (event.pointerId === this.pointerId) this.pointerId = null;
    this.panning = false;
    this.panStart = null;
    if (this.pointers.size < 2) this.pinchStart = null;
    if (this.pointers.size === 0) this.gesturing = false;
  };

  /** Desktop testing: wheel zooms around the cursor. */
  private onWheel = (event: WheelEvent): void => {
    if (!this.ready) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    this.zoomAround(event.clientX, event.clientY, this.zoom.scale * factor);
  };

  private startPinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    this.pinchStart = {
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      zoom: { ...this.zoom },
    };
  }

  private movePinch(): void {
    const start = this.pinchStart;
    const [a, b] = [...this.pointers.values()];
    if (!start || !a || !b) return;
    const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const scale = Math.min(MAX_ZOOM, Math.max(1, start.zoom.scale * (dist / start.dist)));
    // Content point under the starting midpoint follows the moving midpoint.
    const origin = this.stageOrigin();
    const sx = start.mid.x - origin.x;
    const sy = start.mid.y - origin.y;
    const ux = (sx - start.zoom.x) / start.zoom.scale;
    const uy = (sy - start.zoom.y) / start.zoom.scale;
    this.zoom = {
      scale,
      x: mid.x - origin.x - ux * scale,
      y: mid.y - origin.y - uy * scale,
    };
    this.applyZoom();
  }

  /** Throws away a stroke that has not been committed to the paint layer. */
  private cancelStroke(): void {
    if (!this.stroking) return;
    this.stroking = false;
    reset(this.stroke.ctx);
    this.stroke.ctx.clearRect(0, 0, this.w, this.h);
    this.last = null;
    this.hasDab = false;
    this.render();
  }
}
