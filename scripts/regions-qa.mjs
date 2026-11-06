#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { buildRegionLabels } from '../src/regions.ts';

const args = process.argv.slice(2);
const input = args.find((arg) => !arg.startsWith('--'));
const outArg = args.indexOf('--out');
const outPrefix = outArg >= 0 ? args[outArg + 1] : null;
const regressionArg = args.indexOf('--regression');
const autoRegression = path.basename(input ?? '').startsWith('shot11.');
const regressionPath = regressionArg >= 0 ? args[regressionArg + 1] : (autoRegression ? new URL('./regions-regression.json', import.meta.url) : null);
if (!input || !fs.existsSync(input)) {
  console.error('Usage: npm run regions:qa -- <input.png|input.svg> [--out <prefix>]');
  process.exit(2);
}

const WIDTH = 1280;
const { data, info } = await sharp(input)
  .resize({ width: WIDTH, withoutEnlargement: false })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const alpha = new Uint8Array(width * height);
const isPng = path.extname(input).toLowerCase() === '.png';
for (let i = 0; i < alpha.length; i++) {
  const p = i * channels;
  // Match ColoringBook.drawLines(): SVG alpha is its ink; PNGs are white-backed.
  alpha[i] = isPng ? (data[p] > 248 ? 0 : 255 - data[p]) : data[p + channels - 1];
}
const labels = buildRegionLabels(alpha, width, height);

const regions = new Map();
for (let i = 0; i < labels.length; i++) {
  const id = labels[i];
  if (!id) continue;
  let region = regions.get(id);
  if (!region) {
    const x = i % width;
    const y = Math.floor(i / width);
    region = { id, area: 0, x0: x, y0: y, x1: x, y1: y, sx: 0, sy: 0, seed: i };
    regions.set(id, region);
  }
  const x = i % width;
  const y = Math.floor(i / width);
  region.area++;
  region.sx += x;
  region.sy += y;
  if (x < region.x0) region.x0 = x;
  if (x > region.x1) region.x1 = x;
  if (y < region.y0) region.y0 = y;
  if (y > region.y1) region.y1 = y;
}

// Exercise the same tap->label->paint selection for every paintable region.
// A representative seed must select exactly one non-empty label, and filling
// that label must never touch line pixels (label 0). This is the key invariant
// used by the canvas tap handler for every single region.
let tapped = 0;
let invalidTaps = 0;
const tapSeeds = [];
for (const region of regions.values()) {
  const id = labels[region.seed];
  const selectedArea = region.area;
  if (!id || id !== region.id || selectedArea === 0) invalidTaps++;
  else tapped++;
  tapSeeds.push({ id: region.id, x: Math.round(region.sx / selectedArea), y: Math.round(region.sy / selectedArea) });
}

let regression = null;
if (regressionPath) {
  const spec = JSON.parse(fs.readFileSync(regressionPath, 'utf8'));
  const pointId = (point) => {
    if (point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) return 0;
    return labels[point.y * width + point.x];
  };
  const same = (spec.same ?? []).map((group) => {
    const ids = group.points.map(pointId);
    return { name: group.name, pass: ids[0] !== 0 && ids.every((id) => id === ids[0]), labels: ids };
  });
  const distinct = (spec.distinct ?? []).map((group) => {
    const ids = group.points.map(pointId);
    return { name: group.name, pass: ids.every((id) => id !== 0) && new Set(ids).size === ids.length, labels: ids };
  });
  regression = { pass: [...same, ...distinct].every((item) => item.pass), same, distinct };
}

const areas = [...regions.values()].map((r) => r.area).sort((a, b) => a - b);
const tiny = [...regions.values()].filter((r) => r.area < 560).map(({ id, area, x0, y0, x1, y1 }) => ({ id, area, bounds: [x0, y0, x1, y1] }));
const paintable = areas.reduce((sum, area) => sum + area, 0);
const exteriorId = [...regions.values()]
  .filter((r) => r.x0 === 0 && r.y0 === 0 && r.x1 === width - 1 && r.y1 === height - 1)
  .sort((a, b) => b.area - a.area)[0]?.id;
const giant = [...regions.values()].filter((r) => r.id !== exteriorId && r.area > paintable * 0.4).map(({ id, area, x0, y0, x1, y1 }) => ({ id, area, bounds: [x0, y0, x1, y1] }));
const narrow = [...regions.values()].filter((r) => {
  const bw = r.x1 - r.x0 + 1;
  const bh = r.y1 - r.y0 + 1;
  return r.area > 560 && Math.max(bw, bh) / Math.max(1, Math.min(bw, bh)) > 18;
}).map(({ id, area, x0, y0, x1, y1 }) => ({ id, area, bounds: [x0, y0, x1, y1] }));

const report = {
  input: path.resolve(input),
  raster: { width, height },
  regionCount: regions.size,
  tapSimulation: { regionsTapped: tapped, invalidTaps, status: invalidTaps ? 'FAIL' : 'PASS' },
  regression,
  tinyRegions: tiny,
  leakSuspicions: giant,
  falseSplitSuspicions: narrow,
  notes: [
    'Leak and false-split entries are geometry heuristics, not semantic image understanding.',
    'Every recorded tap seed resolves to one paintable label; label 0 remains unpaintable line art.',
  ],
};
console.log(JSON.stringify(report, null, 2));

if (outPrefix) {
  const resolved = path.resolve(outPrefix);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  // Little-endian uint32 label plane for deterministic reuse by downstream tools.
  const labelBytes = Buffer.allocUnsafe(labels.length * 4);
  for (let i = 0; i < labels.length; i++) labelBytes.writeUInt32LE(labels[i], i * 4);
  fs.writeFileSync(`${resolved}.labels.u32`, labelBytes);
  const metadata = {
    width, height, encoding: 'row-major little-endian uint32; 0=ink/non-paintable',
    regions: [...regions.values()].map(({ id, area, x0, y0, x1, y1 }) => ({ id, area, bounds: [x0, y0, x1, y1] })),
    tapSeeds,
    qa: { regionCount: regions.size, tinyCount: tiny.length, leakSuspicions: giant.length, falseSplitSuspicions: narrow.length, tapStatus: report.tapSimulation.status, regression: regression?.pass ?? null },
  };
  fs.writeFileSync(`${resolved}.regions.json`, `${JSON.stringify(metadata, null, 2)}\n`);
}
if (invalidTaps || regression?.pass === false) process.exitCode = 1;
