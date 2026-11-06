/**
 * Region map for the coloring page.
 * Black line pixels are walls. Small gaps in the outline are closed so
 * a fill does not leak through a break of a couple of pixels.
 * Labels are 4-connected: 0 is a wall, any other number is a paintable area.
 */

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
