/**
 * Region map for the coloring page.
 * Solid ink separates meaningful areas (eyes, star, apple, inner ear).
 * Soft gray edges are painted too, so a fill meets the black line without a
 * white halo. Small unlined pockets may join a neighbor, but regions bounded
 * by real ink are retained even when narrow or small. Labels are 4-connected:
 * 0 is solid ink, any other number is paintable.
 */

const SOFT_ALPHA = 72;
const HARD_ALPHA = 200;
/** Bridges breaks of a few pixels in the outline. The drawn lines are unchanged. */
const GAP_RADIUS = 4;
/**
 * Thin pockets below this join the area around them.
 * A compact blob (the bear's small eye) is kept even when it is under this size.
 */
const MIN_REGION_AREA = 560;
const KEEP_COMPACT_AREA = 160;
const KEEP_COMPACT_SIDE = 12;
const ABSORB_RADIUS = 10;
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
 * Walls for connectivity, then small pockets join a neighbor, then the
 * anti-aliased fringe is claimed so color runs under the gray edge of a line.
 */
export function buildRegionLabels(alpha: Uint8Array, w: number, h: number): Uint32Array {
  const soft = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) soft[i] = alpha[i] > SOFT_ALPHA ? 1 : 0;
  const closed = closeGaps(soft, w, h, GAP_RADIUS);
  const labels = labelRegions(closed, w, h);
  // Closing is only a connectivity aid. A synthetic wall with no nearby ink
  // in the source raster is not a real boundary: join the labels it created.
  // Genuine lines (including short endpoint gaps) retain source-mask evidence.
  mergeUninkedInterfaces(labels, soft, closed, w, h);
  absorbSmall(labels, w, h, MIN_REGION_AREA, soft);
  trimPeninsulas(labels, w, h, TRIM_RADIUS);
  claimFringe(labels, alpha, w, h, HARD_ALPHA);
  claimEnclosed(labels, alpha, w, h, HARD_ALPHA, ABSORB_RADIUS);
  // Fringe claiming and pocket cleanup can leave two IDs touching on white
  // pixels. Such a seam has no real line in the source, so it is not a region
  // boundary (notably on the unlined cheek area).
  mergeAdjacentWithoutInk(labels, soft, w, h);
  return labels;
}

/**
 * Undo false partitions introduced by morphology. We inspect only pixels added
 * by closing and merge the labels on their sides only when the original line
 * mask has no nearby evidence. This deliberately leaves visible ink boundaries
 * and short line-end gaps protected by their nearby original stroke pixels.
 */
function mergeUninkedInterfaces(
  labels: Uint32Array,
  source: Uint8Array,
  closed: Uint8Array,
  w: number,
  h: number,
): void {
  let maxLabel = 0;
  for (const id of labels) if (id > maxLabel) maxLabel = id;
  if (maxLabel < 2) return;
  const parent = new Uint32Array(maxLabel + 1);
  for (let id = 0; id <= maxLabel; id++) parent[id] = id;
  const find = (id: number): number => {
    let root = id;
    while (parent[root] !== root) root = parent[root];
    while (parent[id] !== id) {
      const next = parent[id];
      parent[id] = root;
      id = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const evidenceRadius = GAP_RADIUS + 1;
  const searchRadius = GAP_RADIUS + 1;
  const nearby = new Uint32Array((searchRadius * 2 + 1) ** 2);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!closed[i] || source[i]) continue;
      let hasSourceInk = false;
      const ey0 = Math.max(0, y - evidenceRadius);
      const ey1 = Math.min(h - 1, y + evidenceRadius);
      const ex0 = Math.max(0, x - evidenceRadius);
      const ex1 = Math.min(w - 1, x + evidenceRadius);
      for (let yy = ey0; yy <= ey1 && !hasSourceInk; yy++) {
        const row = yy * w;
        for (let xx = ex0; xx <= ex1; xx++) {
          if (source[row + xx]) { hasSourceInk = true; break; }
        }
      }
      if (hasSourceInk) continue;

      let count = 0;
      const y0 = Math.max(0, y - searchRadius);
      const y1 = Math.min(h - 1, y + searchRadius);
      const x0 = Math.max(0, x - searchRadius);
      const x1 = Math.min(w - 1, x + searchRadius);
      for (let yy = y0; yy <= y1; yy++) {
        const row = yy * w;
        for (let xx = x0; xx <= x1; xx++) {
          const id = labels[row + xx];
          if (!id) continue;
          let exists = false;
          for (let n = 0; n < count; n++) if (nearby[n] === id) { exists = true; break; }
          if (!exists) nearby[count++] = id;
        }
      }
      if (count < 2) continue;
      for (let n = 1; n < count; n++) union(nearby[0], nearby[n]);
    }
  }
  for (let i = 0; i < labels.length; i++) if (labels[i]) labels[i] = find(labels[i]);
}

function mergeAdjacentWithoutInk(labels: Uint32Array, source: Uint8Array, w: number, h: number): void {
  let maxLabel = 0;
  for (const id of labels) if (id > maxLabel) maxLabel = id;
  if (maxLabel < 2) return;
  const parent = new Uint32Array(maxLabel + 1);
  for (let id = 0; id <= maxLabel; id++) parent[id] = id;
  const find = (id: number): number => {
    let root = id;
    while (parent[root] !== root) root = parent[root];
    while (parent[id] !== id) {
      const next = parent[id];
      parent[id] = root;
      id = next;
    }
    return root;
  };
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      const a = labels[i];
      if (!a || source[i]) continue;
      if (x + 1 < w) {
        const b = labels[i + 1];
        if (b && b !== a && !source[i + 1]) {
          const ra = find(a); const rb = find(b);
          if (ra !== rb) parent[rb] = ra;
        }
      }
      if (y + 1 < h) {
        const b = labels[i + w];
        if (b && b !== a && !source[i + w]) {
          const ra = find(a); const rb = find(b);
          if (ra !== rb) parent[rb] = ra;
        }
      }
    }
  }
  for (let i = 0; i < labels.length; i++) if (labels[i]) labels[i] = find(labels[i]);
}

function absorbSmall(labels: Uint32Array, w: number, h: number, minArea: number, source: Uint8Array): void {
  let maxLabel = 0;
  for (let i = 0; i < labels.length; i++) if (labels[i] > maxLabel) maxLabel = labels[i];
  const area = new Uint32Array(maxLabel + 1);
  const perimeter = new Uint32Array(maxLabel + 1);
  const inkPerimeter = new Uint32Array(maxLabel + 1);
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
      if (x === 0 || labels[row + x - 1] === 0) {
        perimeter[id]++;
        if (x > 0 && source[row + x - 1]) inkPerimeter[id]++;
      }
      if (x + 1 === w || labels[row + x + 1] === 0) {
        perimeter[id]++;
        if (x + 1 < w && source[row + x + 1]) inkPerimeter[id]++;
      }
      if (y === 0 || labels[row + x - w] === 0) {
        perimeter[id]++;
        if (y > 0 && source[row + x - w]) inkPerimeter[id]++;
      }
      if (y + 1 === h || labels[row + x + w] === 0) {
        perimeter[id]++;
        if (y + 1 < h && source[row + x + w]) inkPerimeter[id]++;
      }
      if (x < minX[id]) minX[id] = x;
      if (x > maxX[id]) maxX[id] = x;
      if (y < minY[id]) minY[id] = y;
      if (y > maxY[id]) maxY[id] = y;
    }
  }

  const keep = (id: number): boolean => {
    if (!id || area[id] === 0 || area[id] >= minArea) return true;
    const short = Math.min(maxX[id] - minX[id], maxY[id] - minY[id]) + 1;
    const realLineRatio = perimeter[id] ? inkPerimeter[id] / perimeter[id] : 0;
    // A genuinely ink-bounded part (e.g. a hand, eye, apple or clothing strap)
    // must not be swallowed just because it has a small or narrow silhouette.
    if (inkPerimeter[id] >= 12 && realLineRatio >= 0.12) return true;
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
          if (dist === 0 || dist > search2 || dist >= bestD) continue;
          const other = labels[row + xx];
          if (!other || other === previous) continue;
          best = other;
          bestD = dist;
        }
      }
      handed[i] = best || previous;
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
