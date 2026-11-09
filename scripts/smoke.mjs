/**
 * Проверка пути MVP:
 * Меню → Альбомы → Картинка → раскрасить → Готово → Награда → Мои рисунки.
 *
 * Запуск:
 *   npm run build
 *   npx vite preview --port 4173 --strictPort
 *   npm i -D playwright && npx playwright install chromium
 *   node scripts/smoke.mjs
 *
 * Playwright не входит в зависимости проекта: скрипт нужен только на проверке,
 * а браузер весит больше, чем всё приложение.
 *
 * Переменные окружения:
 *   SMOKE_BASE — адрес собранной сборки (по умолчанию vite preview)
 *   SMOKE_DIR  — куда положить скриншоты (по умолчанию ./.smoke)
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { register } from "node:module";
await register(new URL("./ts-loader.mjs", import.meta.url).href, import.meta.url);
await import("./regions.test.ts");

async function airplaneIsolation(page, size) {
  await page.goto(`${BASE}#/picture/ryzhik_samoletik`, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas.sheet");
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Заливка", exact: true }).click();
  const face = [590, 275], grass = [200, 650];
  const details = [[515, 320], [650, 300], [560, 297], [662, 266], [620, 330], [621, 380], [620, 370]];
  const flowers = [[53, 540], [56, 515], [28, 528], [80, 532], [30, 555], [52, 566], [143, 559], [117, 572], [167, 576], [142, 584], [119, 597], [162, 600], [140, 607]];
  const sample = points => page.locator("canvas.sheet").evaluate((canvas, pts) => {
    const ctx = canvas.getContext("2d");
    return pts.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
  }, points);
  for (const [name, target, protectedPoints] of [["face", face, details], ["grass", grass, flowers]]) {
    const points = [target, ...protectedPoints];
    const before = await sample(points);
    const box = await page.locator("canvas.sheet").boundingBox();
    await page.touchscreen.tap(box.x + box.width * target[0] / 1280, box.y + box.height * target[1] / 715);
    await page.waitForTimeout(100);
    const after = await sample(points);
    check(JSON.stringify(after[0]) !== JSON.stringify(before[0]), `${size.name}: ${name} tap must paint`);
    for (let i = 1; i < points.length; i++) {
      check(JSON.stringify(after[i]) === JSON.stringify(before[i]), `${size.name}: ${name} leaks into ${points[i]}`);
    }
    await page.getByRole("button", { name: "Отменить", exact: true }).click();
    check(JSON.stringify(await sample(points)) === JSON.stringify(before), `${size.name}: undo ${name}`);
  }
  console.log(`${size.name}: airplane face/grass taps preserve eyes, highlights, mouth and flowers`);
}

const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4173/ryzhik-coloring/";
const OUT = process.env.SMOKE_DIR ?? ".smoke";
const SIZES = [
  { name: "360x640", width: 360, height: 640 },
  { name: "390x844", width: 390, height: 844 },
  { name: "834x1112", width: 834, height: 1112 },
];

/** Минимальный размер нажимаемого элемента в детской зоне, по дизайн-документу. */
const MIN_TAP = 64;
/** Доля закрашенных областей после сетки тапов: сколько реально закрасилось. */
const MIN_PAINTED_RATIO = 0.3;

const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

for (const size of SIZES) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    hasTouch: true,
    isMobile: size.width < 600,
  });
  const page = await context.newPage();

  page.on("pageerror", (error) => failures.push(`${size.name}: ошибка на странице ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`${size.name}: console ${message.text()}`);
  });

  await page.goto(BASE, { waitUntil: "networkidle" });
  check(await page.getByRole("button", { name: "Раскраски" }).isVisible(), `${size.name}: нет входа «Раскраски»`);
  await page.screenshot({ path: `${OUT}/${size.name}-1-menu.png` });

  await page.getByRole("button", { name: "Раскраски" }).click();
  await page.getByRole("button", { name: "Рыжик и его друзья" }).click();
  await page.getByRole("button", { name: "Рыжик и Мишка" }).click();
  await page.waitForSelector(".sheet");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${size.name}-2-coloring.png` });

  // Инструменты обязаны быть не меньше 64dp, иначе ребёнок промахивается.
  const targets = await page.evaluate(MIN => {
    const small = [];
    for (const node of document.querySelectorAll("button")) {
      const box = node.getBoundingClientRect();
      if (!box.width && !box.height) continue;
      if (box.width < MIN - 0.5 || box.height < MIN - 0.5) {
        const label = (node.getAttribute("aria-label") || node.textContent || "").trim().slice(0, 24);
        small.push(`${label} ${Math.round(box.width)}x${Math.round(box.height)}`);
      }
    }
    return small;
  }, MIN_TAP);
  // «Родителям» намеренно 56dp: это не детская кнопка.
  for (const item of targets) check(item.startsWith("Родителям"), `${size.name}: кнопка меньше 64dp — ${item}`);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!overflow, `${size.name}: горизонтальное переполнение на экране раскраски`);

  // «Готово» обязана быть доступна с первой секунды, на чистом листе.
  check(
    await page.getByRole("button", { name: "Готово" }).isEnabled(),
    `${size.name}: «Готово» заблокирована на чистом листе`,
  );

  // Закрашиваем сеткой точек: проверяем, что заливка вообще работает.
  const sheet = await page.locator(".sheet").boundingBox();
  check(Boolean(sheet), `${size.name}: холст не отрисован`);
  for (let row = 0; sheet && row < 10; row++) {
    for (let col = 0; col < 18; col++) {
      await page.mouse.click(
        sheet.x + sheet.width * (0.04 + col * 0.053),
        sheet.y + sheet.height * (0.06 + row * 0.095),
      );
    }
  }
  await page.screenshot({ path: `${OUT}/${size.name}-3-painted.png` });

  // Автосохранение отложенное (полсекунды после последнего действия), поэтому
  // ждём саму запись, а не фиксированную паузу.
  await page
    .waitForFunction(
      () => {
        const raw = localStorage.getItem("ryzhik:progress");
        const ratio = raw ? JSON.parse(raw)?.pictures?.shot11?.ratio : 0;
        return (ratio ?? 0) > 0;
      },
      null,
      { timeout: 5000 },
    )
    .catch(() => undefined);

  const ratio = await page.evaluate(async () => {
    const stored = localStorage.getItem("ryzhik:progress");
    const progress = stored ? JSON.parse(stored) : null;
    return progress?.pictures?.shot11?.ratio ?? 0;
  });
  check(
    ratio >= MIN_PAINTED_RATIO,
    `${size.name}: заливка по тапам не сработала — закрашено ${Math.round(ratio * 100)}%`,
  );

  await page.getByRole("button", { name: "Готово" }).click();
  await page.waitForTimeout(1200);
  check(page.url().includes("#/reward/"), `${size.name}: «Готово» не привело на награду (${page.url()})`);
  await page.screenshot({ path: `${OUT}/${size.name}-4-reward.png` });

  await page.getByRole("button", { name: "В мои рисунки" }).click();
  await page.waitForTimeout(600);
  const saved = await page.locator(".gallery__item").count();
  check(saved > 0, `${size.name}: рисунок не попал в галерею`);
  await page.screenshot({ path: `${OUT}/${size.name}-5-gallery.png` });

  await airplaneIsolation(page, size);
  await context.close();
}

// Ворота: без ответа в родительский раздел не пускают.
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
await page.goto(`${BASE}#/parent`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
check(page.url().includes("#/gate/"), `ворота: #/parent открылся без проверки (${page.url()})`);

// Три ошибки подряд закрывают клавиатуру на 30 секунд.
for (let attempt = 0; attempt < 3; attempt++) {
  for (const digit of "99") await page.getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: "Проверить" }).click();
  await page.waitForTimeout(80);
}
const keysBlocked = await page.locator(".gate__key:disabled").count();
check(keysBlocked > 0, "ворота: после трёх ошибок клавиатура не заблокирована");
await page.screenshot({ path: `${OUT}/gate-cooldown.png` });

await context.close();
await browser.close();

if (failures.length) {
  console.error(`\nПровалено ${failures.length}:`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`Путь MVP пройден на ${SIZES.length} размерах. Скриншоты: ${OUT}`);
