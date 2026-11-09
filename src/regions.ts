/** Shared by the browser and offline generator. Visible artwork is never modified. */
export const REGION_RASTER_WIDTH = 1280;
/** Ink opacity >=72 corresponds to grayscale <=183 on white. */
export const REGION_OPTIONS = { inkThreshold: 72, closingRadius: 2, fringeRadius: 2 } as const;
export type RegionOptions = { inkThreshold?: number; closingRadius?: 0 | 1 | 2; fringeRadius?: 0 | 1 | 2 };

function dilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(src.length);
  const dst = new Uint8Array(src.length);

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      let on = 0;
      for (let xx = x0; xx <= x1; xx++) {
        if (src[row + xx]) {
          on = 1;
          break;
        }
      }
      tmp[row + x] = on;
    }
  }

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(h - 1, y + r);
      let on = 0;
      for (let yy = y0; yy <= y1; yy++) {
        if (tmp[yy * w + x]) {
          on = 1;
          break;
        }
      }
      dst[y * w + x] = on;
    }
  }

  return dst;
}

function erode(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(src.length);
  const dst = new Uint8Array(src.length);

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let on = 1;
      for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
        if (!src[row + xx]) {
          on = 0;
          break;
        }
      }
      tmp[row + x] = on;
    }
  }

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let on = 1;
      for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) {
        if (!tmp[yy * w + x]) {
          on = 0;
          break;
        }
      }
      dst[y * w + x] = on;
    }
  }

  return dst;
}

/** Close breaks up to about 2×radius pixels without permanently thickening lines. */
export function closeGaps(src: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius <= 0) return src;
  return erode(dilate(src, w, h, radius), w, h, radius);
}

export function labelRegions(barrier: Uint8Array, w: number, h: number): Uint32Array {
  const labels = new Uint32Array(w * h);
  const parent = new Int32Array(w * h + 1);
  let next = 1;

  const find = (a: number): number => {
    let root = a;
    while (parent[root] !== root) root = parent[root];
    while (a !== root) {
      const n = parent[a];
      parent[a] = root;
      a = n;
    }
    return root;
  };

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      if (barrier[i]) continue;
      const left = x > 0 ? labels[i - 1] : 0;
      const up = y > 0 ? labels[i - w] : 0;
      if (left === 0 && up === 0) {
        parent[next] = next;
        labels[i] = next;
        next++;
      } else if (up === 0 || left === up) {
        labels[i] = left || up;
      } else if (left === 0) {
        labels[i] = up;
      } else {
        const leftRoot = find(left);
        const upRoot = find(up);
        if (leftRoot !== upRoot) parent[upRoot] = leftRoot;
        labels[i] = leftRoot;
      }
    }
  }

  for (let i = 0; i < labels.length; i++) {
    if (labels[i]) labels[i] = find(labels[i]);
  }
  return labels;
}

export function paintLabel(
  labels: Uint32Array,
  id: number,
  data: Uint8ClampedArray,
  r: number,
  g: number,
  b: number,
): number {
  if (!id) return 0;
  let changed = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== id) continue;
    const p = i * 4;
    if (data[p] !== r || data[p + 1] !== g || data[p + 2] !== b || data[p + 3] !== 255) {
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = 255;
      changed++;
    }
  }
  return changed;
}

/** Threshold physical ink, then close short breaks without changing the art.
 * Preserve any enclosed component that closing would otherwise erase entirely.
 */
export function buildLineMask(alpha: Uint8Array, w: number, h: number, options: RegionOptions = {}): Uint8Array {
  const threshold = options.inkThreshold ?? REGION_OPTIONS.inkThreshold;
  const radius = options.closingRadius ?? REGION_OPTIONS.closingRadius;
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 255 || ![0, 1, 2].includes(radius)) {
    throw new Error("Invalid region mask options");
  }
  const wall = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) wall[i] = alpha[i] >= threshold ? 1 : 0;
  if (!radius) return wall;
  const closed = closeGaps(wall, w, h, radius);
  const original = labelRegions(wall, w, h);
  const surviving = new Set<number>();
  for (let i = 0; i < original.length; i++) if (!closed[i]) surviving.add(original[i]);
  // Closing may consume a tiny highlight completely. Restore its white pixels,
  // but not a verified 1..3px connection between two separate lobes.
  const vanished = new Uint32Array(original.length);
  let vanishedCount = 0;
  for (let i = 0; i < original.length; i++) {
    const id = original[i];
    if (id && !surviving.has(id)) {
      vanished[i] = id;
      vanishedCount++;
    }
  }
  if (!vanishedCount) return closed;
  const narrow = narrowRuns(vanished, w, h);
  const neckIds = new Set(auditRegionLabels(vanished, w, h).suspectedLeaks.map(leak => leak.id));
  // Reconstruct each lobe into its thin tips. Only competing wave fronts
  // remain closed; deleting every narrow pixel would erase a thin mouth.
  const seedBarrier = new Uint8Array(vanished.length);
  for (let i = 0; i < vanished.length; i++) {
    seedBarrier[i] = !vanished[i] || (neckIds.has(vanished[i]) && narrow[i]) ? 1 : 0;
  }
  const seeds = labelRegions(seedBarrier, w, h);
  const queue = new Int32Array(seeds.length);
  let head = 0, tail = 0;
  for (let i = 0; i < seeds.length; i++) if (seeds[i]) queue[tail++] = i;
  while (head < tail) {
    const i = queue[head++], x = i % w, y = Math.floor(i / w);
    for (const n of [x ? i - 1 : -1, x + 1 < w ? i + 1 : -1, y ? i - w : -1, y + 1 < h ? i + w : -1]) {
      if (n < 0 || !vanished[n] || seeds[n]) continue;
      seeds[n] = seeds[i];
      queue[tail++] = n;
    }
  }
  for (let i = 0; i < original.length; i++) {
    if (!vanished[i]) continue;
    const x = i % w, y = Math.floor(i / w);
    const seam = (x + 1 < w && seeds[i + 1] && seeds[i + 1] !== seeds[i])
      || (y + 1 < h && seeds[i + w] && seeds[i + w] !== seeds[i]);
    if (!seam) closed[i] = 0;
  }
  return closed;
}

/** Paint under AA ink only. Read immutable core labels, never grow from claimed
 * pixels. Equal-distance owners leave a neutral seam at the stroke centre.
 * Fully opaque ink and synthetic gap closures remain barriers.
 */
export function expandUnderLines(core: Uint32Array, alpha: Uint8Array, w: number, h: number, radius = 2): Uint32Array {
  if (![0, 1, 2].includes(radius)) throw new Error("Invalid fringe radius");
  const labels = core.slice();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (core[i] || !alpha[i] || alpha[i] === 255) continue;
    let best = radius * radius + 1;
    let owner = 0;
    let tied = false;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const d = dx * dx + dy * dy;
      const xx = x + dx, yy = y + dy;
      if (!d || d > radius * radius || d > best || xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
      const id = core[yy * w + xx];
      if (!id) continue;
      // Do not jump through a darker stroke centre to its far side.
      let blocked = false;
      const steps = Math.max(Math.abs(dx), Math.abs(dy));
      for (let s = 1; s < steps; s++) {
        const p = (y + Math.round(dy * s / steps)) * w + x + Math.round(dx * s / steps);
        if (alpha[p] > alpha[i]) blocked = true;
      }
      if (blocked) continue;
      if (d < best) { best = d; owner = id; tied = false; }
      else if (id !== owner) tied = true;
    }
    if (!tied && owner) labels[i] = owner;
  }
  return labels;
}

export function buildRegionLabels(alpha: Uint8Array, w: number, h: number, options: RegionOptions = {}): Uint32Array {
  return expandUnderLines(labelRegions(buildLineMask(alpha, w, h, options), w, h), alpha, w, h, options.fringeRadius ?? REGION_OPTIONS.fringeRadius);
}

export type RegionSpot = { area: number; x: number; y: number };
export type RegionAudit = {
  width: number; height: number; regionCount: number; tinyRegions: RegionSpot[];
  suspectedLeaks: (RegionSpot & { id: number; neck: number; parts: number })[];
};

function narrowRuns(labels: Uint32Array, w: number, h: number): Uint8Array {
  const narrow = new Uint8Array(labels.length);
  for (let axis = 0; axis < 2; axis++) {
    const lines = axis ? w : h, length = axis ? h : w, stride = axis ? w : 1;
    for (let line = 0; line < lines; line++) {
      const start = axis ? line : line * w;
      for (let p = 0; p < length;) {
        const id = labels[start + p * stride];
        if (!id) { p++; continue; }
        let end = p + 1;
        while (end < length && labels[start + end * stride] === id) end++;
        if (end - p <= 3 && p > 0 && end < length) {
          for (let q = p; q < end; q++) narrow[start + q * stride] = end - p;
        }
        p = end;
      }
    }
  }
  return narrow;
}

/** Detect bottlenecks independently of closing: remove horizontal/vertical
 * white runs 1..3px wide, then count surviving connected lobes of EACH original
 * region. No 2000px minimum: a small eye/highlight is as important as the sky.
 * A thin dead-end tip is not a neck unless it connects two surviving lobes.
 * Width is measured in raster rows/columns, not by eroding diagonal edges.
 */
export function auditRegionLabels(labels: Uint32Array, w: number, h: number): RegionAudit {
  const stats = new Map<number, { n: number; sx: number; sy: number }>();
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i];
    if (!id) continue;
    let s = stats.get(id);
    if (!s) { s = { n: 0, sx: 0, sy: 0 }; stats.set(id, s); }
    s.n++; s.sx += i % w; s.sy += Math.floor(i / w);
  }
  const narrow = narrowRuns(labels, w, h);
  const barrier = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i++) barrier[i] = !labels[i] || narrow[i] ? 1 : 0;
  const cores = labelRegions(barrier, w, h);
  const parts = new Map<number, Set<number>>();
  for (let i = 0; i < labels.length; i++) if (cores[i]) {
    let set = parts.get(labels[i]);
    if (!set) { set = new Set(); parts.set(labels[i], set); }
    set.add(cores[i]);
  }
  const suspectedLeaks: RegionAudit["suspectedLeaks"] = [];
  for (const [id, set] of parts) {
    if (set.size < 2) continue;
    const i = labels.findIndex((value, index) => value === id && narrow[index] > 0);
    suspectedLeaks.push({ id, area: stats.get(id)!.n, x: i % w, y: Math.floor(i / w), neck: narrow[i], parts: set.size });
  }
  const tinyRegions = [...stats.values()].filter(s => s.n < 160).map(s => ({ area: s.n, x: Math.floor(s.sx / s.n), y: Math.floor(s.sy / s.n) }));
  return { width: w, height: h, regionCount: stats.size, tinyRegions, suspectedLeaks };
}

export function auditRegions(alpha: Uint8Array, w: number, h: number, options: RegionOptions = {}): RegionAudit {
  // Audit topology BEFORE cosmetic fringe ownership.
  return auditRegionLabels(labelRegions(buildLineMask(alpha, w, h, options), w, h), w, h);
}

/** Exact pixel first, otherwise the closest paintable pixel within radius. */
export function nearestLabel(
  labels: Uint32Array,
  w: number,
  h: number,
  x: number,
  y: number,
  radius: number,
): number {
  const cx = Math.round(x);
  const cy = Math.round(y);
  if (cx >= 0 && cy >= 0 && cx < w && cy < h) {
    const hit = labels[cy * w + cx];
    if (hit) return hit;
  }

  const r = Math.ceil(radius);
  const r2 = radius * radius;
  let best = 0;
  let bestD = r2 + 1;
  for (let dy = -r; dy <= r; dy++) {
    const yy = cy + dy;
    if (yy < 0 || yy >= h) continue;
    const row = yy * w;
    for (let dx = -r; dx <= r; dx++) {
      const dist = dx * dx + dy * dy;
      if (dist === 0 || dist > r2 || dist >= bestD) continue;
      const xx = cx + dx;
      if (xx < 0 || xx >= w) continue;
      const label = labels[row + xx];
      if (!label) continue;
      best = label;
      bestD = dist;
    }
  }
  return best;
}
