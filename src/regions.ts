/**
 * Region map for the coloring page.
 * Solid ink separates meaningful areas (eyes, star, apple, inner ear).
 * Soft gray edges are painted too, so a fill meets the black line without a
 * white halo. Pockets smaller than a tuft gap join the region around them.
 * Labels are 4-connected: 0 is solid ink, any other number is paintable.
 */

/** Working width for region maps. The page scales this bitmap to the screen. */
export const REGION_RASTER_WIDTH = 1280;

const SOFT_ALPHA = 72;
const HARD_ALPHA = 200;
/**
 * A line end is joined to nearby ink only when it points at that ink.
 * This closes a break in an outline and does not grow every stroke,
 * so fur tips do not cut a cheek in two. The drawn lines are unchanged.
 */
const ENDPOINT_GAP = 32;
/**
 * Thin pockets below this join the area around them.
 * A compact blob (the bear's small eye) is kept even when it is under this size.
 */
const MIN_REGION_AREA = 560;
const KEEP_COMPACT_AREA = 160;
const KEEP_COMPACT_SIDE = 12;
const ABSORB_RADIUS = 10;
/**
 * A pocket this small that touches a much larger area on blank paper
 * is a tuft gap, not its own region. Eyebrows and eye highlights stay:
 * a real line sits between them and the area around them.
 */
const OPEN_TOUCH_AREA = 220;
/** Spikes narrower than about two strokes of this radius join the area beside them. */
const TRIM_RADIUS = 2;

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
      if (x - r < 0 || x + r >= w) continue;
      let on = 1;
      for (let xx = x - r; xx <= x + r; xx++) {
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
      if (y - r < 0 || y + r >= h) continue;
      let on = 1;
      for (let yy = y - r; yy <= y + r; yy++) {
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

/**
 * Visible ink, then short bridges from line ends, then small pockets join a
 * neighbor, then the gray edge of a line is painted with the area beside it.
 */
export function buildRegionLabels(alpha: Uint8Array, w: number, h: number): Uint32Array {
  const visible = visibleWall(alpha);
  const labels = labelRegions(bridgeEndpointGaps(visible, w, h, ENDPOINT_GAP), w, h);
  absorbSmall(labels, w, h, MIN_REGION_AREA);
  trimPeninsulas(labels, w, h, TRIM_RADIUS);
  claimFringe(labels, alpha, w, h, HARD_ALPHA);
  claimEnclosed(labels, alpha, w, h, HARD_ALPHA, ABSORB_RADIUS);
  mergeSmallOpenTouches(labels, alpha, w, h);
  return labels;
}

/**
 * Join a small pocket to the large area it already touches on blank paper.
 * A drawn line keeps the pocket (nothing here merges across ink).
 */
function mergeSmallOpenTouches(labels: Uint32Array, alpha: Uint8Array, w: number, h: number): void {
  let maxLabel = 0;
  for (let i = 0; i < labels.length; i++) if (labels[i] > maxLabel) maxLabel = labels[i];
  const area = new Uint32Array(maxLabel + 1);
  for (let i = 0; i < labels.length; i++) if (labels[i]) area[labels[i]]++;

  const target = new Int32Array(maxLabel + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      const id = labels[i];
      if (!id || area[id] === 0 || area[id] >= OPEN_TOUCH_AREA || alpha[i] > 48) continue;
      const neighbors = [x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1, y > 0 ? i - w : -1, y + 1 < h ? i + w : -1];
      for (const n of neighbors) {
        if (n < 0) continue;
        const other = labels[n];
        if (!other || other === id || alpha[n] > 48) continue;
        if (area[other] < area[id] * 4) continue;
        if (!target[id] || area[other] > area[target[id]]) target[id] = other;
      }
    }
  }

  for (let i = 0; i < labels.length; i++) {
    const dest = target[labels[i]];
    if (dest) labels[i] = dest;
  }
}

function visibleWall(alpha: Uint8Array): Uint8Array {
  const wall = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) wall[i] = alpha[i] > SOFT_ALPHA ? 1 : 0;
  return wall;
}

/**
 * Join a skeleton endpoint to the ink it is pointing at, when that ink is
 * only a short gap away. Parallel strokes are left alone.
 */
export function bridgeEndpointGaps(wall: Uint8Array, w: number, h: number, maxGap: number): Uint8Array {
  const skel = thinMask(wall, w, h);
  const offs: ReadonlyArray<readonly [number, number]> = [
    [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
  ];
  const ends: { x: number; y: number; dx: number; dy: number }[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!skel[y * w + x]) continue;
      let count = 0;
      let nx = x;
      let ny = y;
      for (const [ox, oy] of offs) {
        const xx = x + ox;
        const yy = y + oy;
        if (skel[yy * w + xx]) {
          count++;
          nx = xx;
          ny = yy;
        }
      }
      if (count === 1) ends.push({ x, y, dx: x - nx, dy: y - ny });
    }
  }

  const bridged = wall.slice();
  for (const end of ends) {
    let bestX = 0;
    let bestY = 0;
    let bestD = maxGap;
    const y0 = Math.max(1, end.y - maxGap);
    const y1 = Math.min(h - 2, end.y + maxGap);
    const x0 = Math.max(1, end.x - maxGap);
    const x1 = Math.min(w - 2, end.x + maxGap);
    for (let yy = y0; yy <= y1; yy++) {
      const row = yy * w;
      for (let xx = x0; xx <= x1; xx++) {
        if (!wall[row + xx]) continue;
        const dx = xx - end.x;
        const dy = yy - end.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 4 || dist >= bestD) continue;
        if (dx * end.dx + dy * end.dy <= dist * 0.5) continue;
        bestD = dist;
        bestX = xx;
        bestY = yy;
      }
    }
    if (bestD >= maxGap) continue;
    stampLine(bridged, w, h, end.x, end.y, bestX, bestY);
  }
  return bridged;
}

function stampLine(mask: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number): void {
  let x = x0;
  let y = y0;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  let err = 0;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const steps = Math.max(adx, ady);
  for (let s = 0; s <= steps; s++) {
    if (x >= 0 && y >= 0 && x < w && y < h) mask[y * w + x] = 1;
    const doubled = err * 2;
    if (doubled > -ady) {
      err -= ady;
      x += sx;
    }
    if (doubled < adx) {
      err += adx;
      y += sy;
    }
  }
}

/** Zhang-Suen thinning. The result is only used to find line ends. */
function thinMask(src: Uint8Array, w: number, h: number): Uint8Array {
  const mask = src.slice();
  const neighbors = (i: number): number[] => {
    const y = (i / w) | 0;
    const x = i - y * w;
    const at = (xx: number, yy: number): number =>
      xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : mask[yy * w + xx];
    return [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)];
  };
  const pass = (phase: number): number => {
    const drop: number[] = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!mask[i]) continue;
        const n = neighbors(i);
        const count = n.reduce((sum, value) => sum + value, 0);
        if (count < 2 || count > 6) continue;
        let transitions = 0;
        for (let k = 0; k < 8; k++) if (!n[k] && n[(k + 1) % 8]) transitions++;
        if (transitions !== 1) continue;
        if (phase === 0) {
          if (n[0] * n[2] * n[4] || n[2] * n[4] * n[6]) continue;
        } else if (n[0] * n[2] * n[6] || n[0] * n[4] * n[6]) continue;
        drop.push(i);
      }
    }
    for (const i of drop) mask[i] = 0;
    return drop.length;
  };
  for (let i = 0; i < 80; i++) {
    if (!pass(0) && !pass(1)) break;
  }
  return mask;
}

export type RegionSpot = { area: number; x: number; y: number };

export type RegionAudit = {
  width: number;
  height: number;
  regionCount: number;
  /** Pockets smaller than a kept detail (an eyebrow, a highlight). */
  tinyRegions: RegionSpot[];
  /**
   * Two areas touch on blank paper, and the nearest ink is farther than a stroke.
   * A region boundary should only exist where a line is drawn.
   */
  falseSplits: RegionSpot[];
  /**
   * One area still joins two large parts through a corridor only a few pixels wide.
   * A short gap in the outline is still open.
   */
  suspectedLeaks: { area: number; x: number; y: number; neck: number }[];
};

/** Counts for `npm run regions`. The same rules for every picture, at the working width. */
export function auditRegions(alpha: Uint8Array, w: number, h: number): RegionAudit {
  const labels = buildRegionLabels(alpha, w, h);
  const stats = new Map<number, { n: number; sx: number; sy: number }>();
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i];
    if (!id || alpha[i] > SOFT_ALPHA) continue;
    const y = (i / w) | 0;
    const x = i - y * w;
    let stat = stats.get(id);
    if (!stat) {
      stat = { n: 0, sx: 0, sy: 0 };
      stats.set(id, stat);
    }
    stat.n++;
    stat.sx += x;
    stat.sy += y;
  }

  const tinyRegions = [...stats.entries()]
    .filter(([, stat]) => stat.n < KEEP_COMPACT_AREA)
    .map(([, stat]) => ({ area: stat.n, x: (stat.sx / stat.n) | 0, y: (stat.sy / stat.n) | 0 }));

  const falseSplits = findFalseSplits(labels, alpha, w, h, stats);
  const suspectedLeaks = findNarrowNecks(labels, alpha, w, h, stats);
  return { width: w, height: h, regionCount: stats.size, tinyRegions, falseSplits, suspectedLeaks };
}

/** Farther than this from any ink, two touching areas have no line between them. */
const FALSE_SPLIT_GAP = 16;

function findFalseSplits(
  labels: Uint32Array,
  alpha: Uint8Array,
  w: number,
  h: number,
  stats: Map<number, { n: number; sx: number; sy: number }>,
): RegionSpot[] {
  const seen = new Set<string>();
  const spots: RegionSpot[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const id = labels[i];
      if (!id || alpha[i] > 40) continue;
      const neighbors = [labels[i + 1], labels[i + w]];
      const alphas = [alpha[i + 1], alpha[i + w]];
      for (let n = 0; n < neighbors.length; n++) {
        const other = neighbors[n];
        if (!other || other === id || alphas[n] > 40) continue;
        if (nearestWall(alpha, w, h, x, y) <= FALSE_SPLIT_GAP) continue;
        const key = id < other ? `${id},${other}` : `${other},${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const small = (stats.get(id)?.n ?? 0) <= (stats.get(other)?.n ?? 0) ? id : other;
        const stat = stats.get(small);
        if (!stat) continue;
        spots.push({ area: stat.n, x: (stat.sx / stat.n) | 0, y: (stat.sy / stat.n) | 0 });
      }
    }
  }
  return spots;
}

function nearestWall(alpha: Uint8Array, w: number, h: number, x: number, y: number): number {
  let best = FALSE_SPLIT_GAP + 1;
  const r = FALSE_SPLIT_GAP + 1;
  const y0 = Math.max(0, y - r);
  const y1 = Math.min(h - 1, y + r);
  const x0 = Math.max(0, x - r);
  const x1 = Math.min(w - 1, x + r);
  for (let yy = y0; yy <= y1; yy++) {
    const row = yy * w;
    for (let xx = x0; xx <= x1; xx++) {
      if (alpha[row + xx] <= SOFT_ALPHA) continue;
      const dist = Math.hypot(xx - x, yy - y);
      if (dist < best) best = dist;
    }
  }
  return best;
}

/** Two large parts of one area joined by a corridor thinner than about 8px. */
function findNarrowNecks(
  labels: Uint32Array,
  alpha: Uint8Array,
  w: number,
  h: number,
  stats: Map<number, { n: number; sx: number; sy: number }>,
): RegionAudit["suspectedLeaks"] {
  const neck = 4;
  const dist = new Int16Array(labels.length);
  const queue = new Int32Array(labels.length);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i];
    if (!id || alpha[i] > SOFT_ALPHA) continue;
    const y = (i / w) | 0;
    const x = i - y * w;
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1
      || labels[i - 1] !== id || labels[i + 1] !== id || labels[i - w] !== id || labels[i + w] !== id;
    if (!edge) continue;
    dist[i] = 1;
    queue[tail++] = i;
  }
  while (head < tail) {
    const i = queue[head++];
    const id = labels[i];
    const d = dist[i];
    const y = (i / w) | 0;
    const x = i - y * w;
    const step = (n: number): void => {
      if (dist[n] || labels[n] !== id || alpha[n] > SOFT_ALPHA) return;
      dist[n] = d + 1;
      queue[tail++] = n;
    };
    if (x > 0) step(i - 1);
    if (x + 1 < w) step(i + 1);
    if (y > 0) step(i - w);
    if (y + 1 < h) step(i + w);
  }

  const mark = new Int32Array(labels.length);
  let pid = 0;
  const parts = new Map<number, { n: number; sx: number; sy: number }[]>();
  const qq = new Int32Array(labels.length);
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i];
    if (!id || dist[i] < neck || mark[i]) continue;
    pid++;
    let a = 0;
    let b = 0;
    let n = 0;
    let sx = 0;
    let sy = 0;
    mark[i] = pid;
    qq[b++] = i;
    while (a < b) {
      const p = qq[a++];
      n++;
      const y = (p / w) | 0;
      const x = p - y * w;
      sx += x;
      sy += y;
      const take = (nidx: number): void => {
        if (labels[nidx] === id && dist[nidx] >= neck && !mark[nidx]) {
          mark[nidx] = pid;
          qq[b++] = nidx;
        }
      };
      if (x > 0) take(p - 1);
      if (x + 1 < w) take(p + 1);
      if (y > 0) take(p - w);
      if (y + 1 < h) take(p + w);
    }
    if (n < 2000) continue;
    const list = parts.get(id) ?? [];
    list.push({ n, sx, sy });
    parts.set(id, list);
  }

  const leaks: RegionAudit["suspectedLeaks"] = [];
  for (const [id, list] of parts) {
    if (list.length < 2) continue;
    const stat = stats.get(id);
    if (!stat) continue;
    const small = list.sort((p, q) => p.n - q.n)[0];
    leaks.push({
      area: stat.n,
      x: (small.sx / small.n) | 0,
      y: (small.sy / small.n) | 0,
      neck: neck * 2,
    });
  }
  return leaks;
}

function absorbSmall(labels: Uint32Array, w: number, h: number, minArea: number): void {
  let maxLabel = 0;
  for (let i = 0; i < labels.length; i++) if (labels[i] > maxLabel) maxLabel = labels[i];
  const area = new Uint32Array(maxLabel + 1);
  const minX = new Int32Array(maxLabel + 1);
  const maxX = new Int32Array(maxLabel + 1);
  const minY = new Int32Array(maxLabel + 1);
  const maxY = new Int32Array(maxLabel + 1);
  minX.fill(w);
  minY.fill(h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const id = labels[row + x];
      if (!id) continue;
      area[id]++;
      if (x < minX[id]) minX[id] = x;
      if (x > maxX[id]) maxX[id] = x;
      if (y < minY[id]) minY[id] = y;
      if (y > maxY[id]) maxY[id] = y;
    }
  }

  const keep = (id: number): boolean => {
    if (!id || area[id] === 0 || area[id] >= minArea) return true;
    const short = Math.min(maxX[id] - minX[id], maxY[id] - minY[id]) + 1;
    return area[id] >= KEEP_COMPACT_AREA && short >= KEEP_COMPACT_SIDE;
  };

  let background = labels[0];
  if (!background) {
    for (let i = 0; i < labels.length; i++) {
      const id = labels[i];
      if (id && area[id] > area[background]) background = id;
    }
  }

  // One destination per small region. A large region is never moved.
  const target = new Int32Array(maxLabel + 1);
  const targetScore = new Uint32Array(maxLabel + 1);
  const votes = new Uint32Array(maxLabel + 1);
  const seen = new Int32Array(48);
  const r2 = ABSORB_RADIUS * ABSORB_RADIUS;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      const id = labels[i];
      if (keep(id)) continue;
      const left = x > 0 ? labels[i - 1] : 0;
      const right = x + 1 < w ? labels[i + 1] : 0;
      const up = y > 0 ? labels[i - w] : 0;
      const down = y + 1 < h ? labels[i + w] : 0;
      if (left === id && right === id && up === id && down === id) continue;

      let seenCount = 0;
      let best = 0;
      let bestVotes = 0;
      const y0 = Math.max(0, y - ABSORB_RADIUS);
      const y1 = Math.min(h - 1, y + ABSORB_RADIUS);
      const x0 = Math.max(0, x - ABSORB_RADIUS);
      const x1 = Math.min(w - 1, x + ABSORB_RADIUS);
      for (let yy = y0; yy <= y1; yy++) {
        const dy = yy - y;
        const nRow = yy * w;
        for (let xx = x0; xx <= x1; xx++) {
          const dx = xx - x;
          if (dx * dx + dy * dy > r2) continue;
          const other = labels[nRow + xx];
          if (!other || other === id) continue;
          if (!votes[other]) {
            if (seenCount >= seen.length) continue;
            seen[seenCount++] = other;
          }
          votes[other]++;
        }
      }
      for (let s = 0; s < seenCount; s++) {
        const other = seen[s];
        const count = votes[other];
        votes[other] = 0;
        const prefer = other !== background && (best === 0 || best === background || count > bestVotes);
        const moreBg = other === background && best === 0;
        if (prefer || moreBg || (other !== background && best !== background && count > bestVotes)) {
          best = other;
          bestVotes = count;
        }
      }
      if (!best) continue;
      const score = bestVotes + (best === background ? 0 : 1_000_000);
      if (score > targetScore[id]) {
        target[id] = best;
        targetScore[id] = score;
      }
    }
  }

  const parent = new Int32Array(maxLabel + 1);
  for (let id = 0; id <= maxLabel; id++) parent[id] = id;
  for (let id = 1; id <= maxLabel; id++) {
    const dest = target[id];
    if (!dest || keep(id)) continue;
    // Attach a pocket only to a bigger area, so regions can't point at each other.
    if (area[dest] < area[id] || (area[dest] === area[id] && dest > id)) continue;
    parent[id] = dest;
  }
  const find = (a: number): number => {
    let root = a;
    while (parent[root] !== root) root = parent[root];
    while (a !== root) {
      const next = parent[a];
      parent[a] = root;
      a = next;
    }
    return root;
  };
  for (let i = 0; i < labels.length; i++) {
    if (labels[i]) labels[i] = find(labels[i]);
  }
}

/**
 * Shave thin spikes and inlets off every region (fur gaps, 1px paper leaks)
 * and hand those pixels to the neighboring area.
 */
function trimPeninsulas(labels: Uint32Array, w: number, h: number, radius: number): void {
  const eroded = new Uint32Array(labels.length);
  const tmp = new Uint32Array(labels.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const id = labels[row + x];
      if (!id || x - radius < 0 || x + radius >= w) continue;
      let ok = true;
      for (let xx = x - radius; xx <= x + radius; xx++) {
        if (labels[row + xx] !== id) {
          ok = false;
          break;
        }
      }
      if (ok) tmp[row + x] = id;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const id = tmp[y * w + x];
      if (!id || y - radius < 0 || y + radius >= h) continue;
      let ok = true;
      for (let yy = y - radius; yy <= y + radius; yy++) {
        if (tmp[yy * w + x] !== id) {
          ok = false;
          break;
        }
      }
      if (ok) eroded[y * w + x] = id;
    }
  }

  const original = labels.slice();
  for (let i = 0; i < labels.length; i++) {
    const id = original[i];
    if (!id) continue;
    const y = (i / w) | 0;
    const x = i - y * w;
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(h - 1, y + radius);
    const x0 = Math.max(0, x - radius);
    const x1 = Math.min(w - 1, x + radius);
    let keep = false;
    for (let yy = y0; yy <= y1 && !keep; yy++) {
      const row = yy * w;
      for (let xx = x0; xx <= x1; xx++) {
        if (eroded[row + xx] === id) {
          keep = true;
          break;
        }
      }
    }
    if (!keep) labels[i] = 0;
  }

  const handed = new Uint32Array(labels.length);
  const search = radius + 8;
  const search2 = search * search;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const previous = original[i];
      if (!previous || labels[i]) continue;
      let best = 0;
      let bestD = search2 + 1;
      let own = 0;
      let ownD = search2 + 1;
      const y0 = Math.max(0, y - search);
      const y1 = Math.min(h - 1, y + search);
      const x0 = Math.max(0, x - search);
      const x1 = Math.min(w - 1, x + search);
      for (let yy = y0; yy <= y1; yy++) {
        const dy = yy - y;
        const row = yy * w;
        for (let xx = x0; xx <= x1; xx++) {
          const dx = xx - x;
          const dist = dx * dx + dy * dy;
          if (dist === 0 || dist > search2) continue;
          const other = labels[row + xx];
          if (!other) continue;
          if (other === previous) {
            if (dist < ownD) {
              own = other;
              ownD = dist;
            }
            continue;
          }
          if (dist < bestD) {
            best = other;
            bestD = dist;
          }
        }
      }
      // A thin edge of a region that is still there stays with that region.
      // Only a spike whose body is gone joins the area beside it.
      handed[i] = own || best || previous;
    }
  }
  for (let i = 0; i < labels.length; i++) {
    if (handed[i]) labels[i] = handed[i];
  }
}

/** Holes sealed inside solid ink still take the color of the area around them. */
function claimEnclosed(
  labels: Uint32Array,
  alpha: Uint8Array,
  w: number,
  h: number,
  hardAlpha: number,
  radius: number,
): void {
  const r2 = radius * radius;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (labels[i] || alpha[i] >= hardAlpha) continue;
      let best = 0;
      let bestD = r2 + 1;
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(h - 1, y + radius);
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w - 1, x + radius);
      for (let yy = y0; yy <= y1; yy++) {
        const dy = yy - y;
        const row = yy * w;
        for (let xx = x0; xx <= x1; xx++) {
          const dx = xx - x;
          const dist = dx * dx + dy * dy;
          if (dist === 0 || dist > r2 || dist >= bestD) continue;
          const other = labels[row + xx];
          if (!other) continue;
          best = other;
          bestD = dist;
        }
      }
      if (best) labels[i] = best;
    }
  }
}

/** Give every soft edge pixel to the nearest already-labeled region. Solid ink stays 0. */
function claimFringe(
  labels: Uint32Array,
  alpha: Uint8Array,
  w: number,
  h: number,
  hardAlpha: number,
): void {
  const queue = new Int32Array(labels.length);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i]) queue[tail++] = i;
  }
  while (head < tail) {
    const i = queue[head++];
    const y = (i / w) | 0;
    const x = i - y * w;
    const id = labels[i];
    if (x > 0) enqueue(i - 1, id);
    if (x + 1 < w) enqueue(i + 1, id);
    if (y > 0) enqueue(i - w, id);
    if (y + 1 < h) enqueue(i + w, id);
  }

  function enqueue(n: number, id: number): void {
    if (labels[n] || alpha[n] >= hardAlpha) return;
    labels[n] = id;
    queue[tail++] = n;
  }
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
