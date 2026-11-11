/** Node 20: imported through ts-loader by regions and smoke. No new dependencies. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { PNG } from "pngjs";
import { auditRegions, buildRegionLabels, buildLineMask, expandUnderLines, labelRegions, paintLabel } from "../src/regions.ts";

// Two lobes (one deliberately smaller than the old 2000px cutoff).
for (const gap of [1, 2, 3]) for (const transpose of [false, true]) {
  const w = 35, h = 35, ink = new Uint8Array(w * h).fill(255);
  const put = (x: number, y: number, value: number): void => { ink[transpose ? x * w + y : y * w + x] = value; };
  for (let y = 3; y < 32; y++) for (let x = 3; x < 32; x++) put(x, y, 0);
  for (let y = 3; y < 32; y++) for (let x = 20; x < 23; x++) put(x, y, 120);
  for (let y = 15; y < 15 + gap; y++) for (let x = 20; x < 23; x++) put(x, y, 0);
  assert.equal(auditRegions(ink, w, h, { closingRadius: 0 }).suspectedLeaks.length, 1, `${gap}px neck must be detected`);
  const after = auditRegions(ink, w, h);
  assert.equal(after.regionCount, 2, `${gap}px gap must close`);
  assert.equal(after.suspectedLeaks.length, 0);
}
// One-pixel enclosed highlights must survive even when a 5x5 closing consumes them.
{
  const ink = new Uint8Array(17 * 17).fill(255);
  ink[8 * 17 + 5] = 0; ink[8 * 17 + 11] = 0;
  const labels = buildRegionLabels(ink, 17, 17);
  assert.ok(labels[8 * 17 + 5]);
  assert.ok(labels[8 * 17 + 11]);
  assert.notEqual(labels[8 * 17 + 5], labels[8 * 17 + 11]);
}
// No exterior-wrap leak at an image edge; gray ink is a barrier.
{
  const ink = new Uint8Array(15 * 15);
  for (let y = 0; y < 15; y++) ink[y * 15 + 7] = 90;
  const mask = buildLineMask(ink, 15, 15);
  assert.equal(mask[7], 1); assert.equal(mask[14 * 15 + 7], 1);
  assert.equal(auditRegions(ink, 15, 15).regionCount, 2);
}
// Immutable nearest ownership, opaque centre, no blank-paper expansion or iteration bias.
{
  const w = 15, h = 9, ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 5; x <= 9; x++) ink[y * w + x] = x === 7 ? 255 : 150;
  const core = labelRegions(buildLineMask(ink, w, h), w, h);
  const labels = expandUnderLines(core, ink, w, h, 2);
  assert.equal(labels[4 * w + 6], core[4 * w + 4]);
  assert.equal(labels[4 * w + 8], core[4 * w + 10]);
  assert.equal(labels[4 * w + 7], 0);
  const pixels = new Uint8ClampedArray(w * h * 4);
  assert.equal(paintLabel(labels, 0, pixels, 255, 0, 0), 0);
  paintLabel(labels, core[4 * w + 4], pixels, 255, 0, 0);
  assert.equal(pixels[(4 * w + 6) * 4 + 3], 255, 'AA fringe is painted');
  assert.equal(pixels[(4 * w + 8) * 4 + 3], 0, 'opposite fringe is untouched');
  ink[4 * w + 6] = 0;
  assert.equal(expandUnderLines(core, ink, w, h)[4 * w + 6], 0, 'synthetic closure is not claimed');
}
// Semantically selected points on the actual 1280x715 artwork, not generated IDs.
const png = PNG.sync.read(new Resvg(readFileSync(new URL('./fixtures/ryzhik_samoletik.svg', import.meta.url)), { fitTo: { mode: 'width', value: 1280 } }).render().asPng());
const alpha = Uint8Array.from({ length: png.width * png.height }, (_, i) => Math.round((255 - png.data[i * 4]) * png.data[i * 4 + 3] / 255));
const labels = buildRegionLabels(alpha, png.width, png.height);
const face = [590, 275], grass = [200, 650];
const details = [[515, 320], [650, 300], [560, 297], [662, 266], [620, 330], [621, 380], [620, 370]];
const flowers = [[53, 540], [56, 515], [28, 528], [80, 532], [30, 555], [52, 566], [143, 559], [117, 572], [167, 576], [142, 584], [119, 597], [162, 600], [140, 607]];
const at = ([x, y]: number[]): number => y * png.width + x;
for (const [target, protectedPoints] of [[face, details], [grass, flowers]] as [number[], number[][]][]) {
  const pixels = new Uint8ClampedArray(labels.length * 4);
  assert.ok(paintLabel(labels, labels[at(target)], pixels, 255, 0, 0));
  for (const point of protectedPoints) {
    assert.ok(labels[at(point)], `detail ${point} must remain paintable`);
    assert.equal(pixels[at(point) * 4 + 3], 0, `fill at ${target} leaks into ${point}`);
  }
}
console.log('Region regressions passed: gaps 1/2/3px, gray ink, edge walls, tiny details, fringe and airplane isolation.');
