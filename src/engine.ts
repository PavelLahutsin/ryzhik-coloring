import { buildRegionLabels, nearestLabel, paintLabel } from "./regions";

export type Tool = "fill" | "pencil" | "brush" | "marker" | "eraser";

const TARGET_WIDTH = 1280;
const HISTORY_LIMIT = 10;
/** Pixels darker than this are the line art, not empty paper. */
const INK_ALPHA = 72;

type Rgb = { r: number; g: number; b: number };
type Layer = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };

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

  onHistory: (() => void) | null = null;

  constructor(
    private view: HTMLCanvasElement,
    private stage: HTMLElement,
  ) {
    const ctx = view.getContext("2d");
    if (!ctx) throw new Error("canvas");
    this.viewCtx = ctx;
    view.addEventListener("pointerdown", this.onPointerDown, { passive: false });
    view.addEventListener("pointermove", this.onPointerMove, { passive: false });
    view.addEventListener("pointerup", this.onPointerUp);
    view.addEventListener("pointercancel", this.onPointerUp);
    view.addEventListener("contextmenu", (event) => event.preventDefault());
    new ResizeObserver(() => this.layout()).observe(stage);
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
    return true;
  }

  async save(filename: string): Promise<boolean> {
    if (!this.ready) return false;
    if (this.stroking) this.finishStroke();
    this.render();
    const blob = await new Promise<Blob | null>((resolve) => {
      this.view.toBlob(resolve, "image/png");
    });
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
    const style = getComputedStyle(this.stage);
    const padX = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
    const padY = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    const maxW = this.stage.clientWidth - padX;
    const maxH = this.stage.clientHeight - padY;
    if (maxW < 8 || maxH < 8) return;
    const aspect = this.w / this.h;
    let cssW = maxW;
    let cssH = cssW / aspect;
    if (cssH > maxH) {
      cssH = maxH;
      cssW = cssH * aspect;
    }
    const left = Number.parseFloat(style.paddingLeft) + (maxW - cssW) / 2;
    const top = Number.parseFloat(style.paddingTop);
    this.view.style.width = `${cssW}px`;
    this.view.style.height = `${cssH}px`;
    this.view.style.left = `${left}px`;
    this.view.style.top = `${top}px`;
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
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.ready || event.button !== 0 || this.pointerId !== null) return;
    event.preventDefault();
    this.pointerId = event.pointerId;
    try {
      this.view.setPointerCapture(event.pointerId);
    } catch {
      /* The pointer can already be gone on a quick tap. */
    }
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
    if (event.pointerId !== this.pointerId || !this.stroking) return;
    event.preventDefault();
    const points = event.getCoalescedEvents?.() ?? [event];
    for (const point of points) {
      const bitmap = this.toBitmap(point);
      this.strokeTo(bitmap.x, bitmap.y);
    }
    this.render();
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.pointerId = null;
    if (this.tool === "fill") {
      const moved = Math.hypot(event.clientX - this.downCss.x, event.clientY - this.downCss.y);
      if (moved < 14) {
        const point = this.toBitmap(event);
        this.fillAt(point.x, point.y);
      }
      return;
    }
    this.finishStroke();
  };
}
