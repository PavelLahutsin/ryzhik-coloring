/**
 * Build region maps for every picture and write a QA report.
 *
 *   npm run regions
 *
 * Input: src/assets/pictures/<id>.svg (or .png). Same rules as the page:
 * grayscale/alpha ink is thresholded and closed before labelling.
 * Output: <id>.qa.json and <id>.regions.png. Any remaining neck fails QA.
 * REGION_CLOSING_RADIUS=0|1|2 overrides the default (2); 0 is a negative control.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { Resvg } from "@resvg/resvg-js";
import { REGION_OPTIONS, REGION_RASTER_WIDTH, auditRegions, buildRegionLabels } from "../src/regions.ts";

const picturesDir = path.resolve("src/assets/pictures");
const closingRadius = Number(process.env.REGION_CLOSING_RADIUS ?? REGION_OPTIONS.closingRadius) as 0 | 1 | 2;
if (![0, 1, 2].includes(closingRadius)) throw new Error("REGION_CLOSING_RADIUS must be 0, 1 or 2");
const options = { ...REGION_OPTIONS, closingRadius };
let failed = false;

async function raster(file: string, width: number): Promise<{ width: number; height: number; alpha: Uint8Array }> {
  const ext = path.extname(file).toLowerCase();
  const bytes = await readFile(file);
  const pngBytes = ext === ".svg"
    ? new Resvg(bytes, { fitTo: { mode: "width", value: width } }).render().asPng()
    : bytes;
  const png = PNG.sync.read(Buffer.from(pngBytes));
  const alpha = new Uint8Array(png.width * png.height);
  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
    const shade = Math.min(png.data[p], png.data[p + 1], png.data[p + 2]);
    const ink = Math.round((255 - shade) * png.data[p + 3] / 255);
    alpha[i] = ink;
  }
  return { width: png.width, height: png.height, alpha };
}

function writeRegionsPng(file: string, labels: Uint32Array, width: number, height: number): Promise<void> {
  const png = new PNG({ width, height });
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i] ?? 0;
    const p = i * 4;
    png.data[p] = id & 255;
    png.data[p + 1] = (id >> 8) & 255;
    png.data[p + 2] = (id >> 16) & 255;
    png.data[p + 3] = 255;
  }
  return writeFile(file, PNG.sync.write(png));
}

const names = new Set<string>();
for (const file of await readdir(picturesDir)) {
  if (!file.endsWith(".svg") && !file.endsWith(".png")) continue;
  if (file.endsWith(".regions.png")) continue;
  names.add(path.basename(file, path.extname(file)));
}

if (names.size === 0) {
  console.log("Нет картинок в src/assets/pictures");
  process.exit(0);
}

for (const id of [...names].sort()) {
  const svg = path.join(picturesDir, `${id}.svg`);
  const png = path.join(picturesDir, `${id}.png`);
  const source = await fileExists(svg) ? svg : png;
  if (!await fileExists(source)) continue;
  const image = await raster(source, REGION_RASTER_WIDTH);
  const scale = REGION_RASTER_WIDTH / image.width;
  const width = REGION_RASTER_WIDTH;
  const height = Math.max(1, Math.round(image.height * scale));
  const alpha = scale === 1 ? image.alpha : scaleAlpha(image.alpha, image.width, image.height, width, height);
  const labels = buildRegionLabels(alpha, width, height, options);
  const before = auditRegions(alpha, width, height, { ...options, closingRadius: 0 });
  const after = auditRegions(alpha, width, height, options);
  const report = { ...after, options, before: { regionCount: before.regionCount, neckCount: before.suspectedLeaks.length }, neckCount: after.suspectedLeaks.length };
  if (report.neckCount) failed = true;
  const qaPath = path.join(picturesDir, `${id}.qa.json`);
  const mapPath = path.join(picturesDir, `${id}.regions.png`);
  await writeFile(qaPath, JSON.stringify(report, null, 2));
  await writeRegionsPng(mapPath, labels, width, height);
  console.log(`${id}: regions ${before.regionCount} -> ${report.regionCount}; necks ${before.suspectedLeaks.length} -> ${report.neckCount}; small details ${report.tinyRegions.length}`);
  for (const leak of report.suspectedLeaks) {
    console.log(`  узкая протечка: область ${leak.area}px около ${leak.x},${leak.y}, горлышко около ${leak.neck}px`);
  }
}

if (failed) { console.error("Region QA failed: narrow necks remain."); process.exitCode = 1; }

async function fileExists(file: string): Promise<boolean> {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

function scaleAlpha(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const dst = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor(y * sh / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor(x * sw / dw));
      dst[y * dw + x] = src[sy * sw + sx] ?? 0;
    }
  }
  return dst;
}
