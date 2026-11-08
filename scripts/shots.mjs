/**
 * Снимки экранов для описания PR. Не часть сборки, как и smoke.mjs.
 *
 *   npm run build
 *   npx vite preview --port 4173 --strictPort
 *   npm i -D --no-save playwright && npx playwright install chromium
 *   SHOTS_BASE=http://127.0.0.1:4173/ryzhik-coloring/ SHOTS_DIR=docs/mvp-screens npm run shots
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.SHOTS_BASE ?? "http://127.0.0.1:4173/ryzhik-coloring/";
const OUT = process.env.SHOTS_DIR ?? "docs/mvp-screens";
const PAINT = [
  [0.12, 0.2], [0.3, 0.18], [0.5, 0.22], [0.7, 0.2], [0.88, 0.26],
  [0.1, 0.45], [0.28, 0.5], [0.5, 0.46], [0.72, 0.5], [0.9, 0.45],
  [0.14, 0.72], [0.34, 0.76], [0.56, 0.7], [0.78, 0.76], [0.92, 0.7],
  [0.2, 0.9], [0.45, 0.92], [0.7, 0.88], [0.86, 0.92], [0.05, 0.92],
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

async function shot(name, size, steps) {
  const context = await browser.newContext({
    viewport: { width: size[0], height: size[1] },
    hasTouch: true,
    isMobile: size[0] < 600,
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await steps(page);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await context.close();
}

/** Красим область за областью, как это делает ребёнок. */
async function paint(page) {
  const sheet = await page.locator(".sheet").boundingBox();
  if (!sheet) return;
  for (const [x, y] of PAINT) {
    await page.mouse.click(sheet.x + sheet.width * x, sheet.y + sheet.height * y);
  }
}

const phone = [390, 844];

await shot("390-1-menu", phone, async () => {});
await shot("390-2-albums", phone, (p) => p.getByRole("button", { name: "Раскраски" }).click());
await shot("390-3-pictures", phone, async (p) => {
  await p.getByRole("button", { name: "Раскраски" }).click();
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: "Рыжик и его друзья" }).click();
});
await shot("390-4-coloring", phone, async (p) => {
  await p.getByRole("button", { name: "Раскраски" }).click();
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: "Рыжик и его друзья" }).click();
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: /Мишка/ }).first().click();
  await p.waitForSelector(".sheet");
  await p.waitForTimeout(1200);
  await p.getByRole("button", { name: "Кисть" }).click();
  await p.waitForTimeout(200);
});
await shot("390-5-painted", phone, async (p) => {
  await p.getByRole("button", { name: "Раскраски" }).click();
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: "Рыжик и его друзья" }).click();
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: /Мишка/ }).first().click();
  await p.waitForSelector(".sheet");
  await p.waitForTimeout(1200);
  await paint(p);
});
await shot("390-6-reward", phone, async (p) => {
  await p.getByRole("button", { name: "Раскраски" }).click();
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: "Рыжик и его друзья" }).click();
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: /Мишка/ }).first().click();
  await p.waitForSelector(".sheet");
  await p.waitForTimeout(1200);
  await paint(p);
  await p.getByRole("button", { name: "Готово" }).click();
  await p.waitForTimeout(1000);
});
await shot("390-7-gallery", phone, async (p) => {
  await p.getByRole("button", { name: "Раскраски" }).click();
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: "Рыжик и его друзья" }).click();
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: /Мишка/ }).first().click();
  await p.waitForSelector(".sheet");
  await p.waitForTimeout(1200);
  await paint(p);
  await p.getByRole("button", { name: "Готово" }).click();
  await p.waitForTimeout(800);
  await p.getByRole("button", { name: "В мои рисунки" }).click();
});
await shot("8-sound", phone, (p) => p.getByRole("button", { name: "Звук" }).click());
await shot("9-gate", phone, (p) => p.getByRole("button", { name: "Родителям" }).click());
await shot("11-parent", phone, async (p) => {
  await p.getByRole("button", { name: "Родителям" }).click();
  await p.waitForTimeout(300);
  // Ответ на ворота известен только тому, кто их видит: читаем задание со страницы.
  const question = await p.locator(".gate__question, .gate").first().innerText();
  const match = question.match(/(\d+)\s*([×+*])\s*(\d+)/);
  if (match) {
    const [, a, op, b] = match;
    const value = op === "+" ? Number(a) + Number(b) : Number(a) * Number(b);
    for (const digit of String(value)) {
      await p.getByRole("button", { name: digit, exact: true }).click();
    }
    await p.getByRole("button", { name: "Проверить" }).click();
    await p.waitForTimeout(600);
  }
});

await shot("360-1-menu", [360, 640], async () => {});
await shot("360-4-coloring", [360, 640], async (p) => {
  await p.getByRole("button", { name: "Раскраски" }).click();
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: "Рыжик и его друзья" }).click();
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: /Мишка/ }).first().click();
  await p.waitForSelector(".sheet");
  await p.waitForTimeout(1200);
});
await shot("834-4-coloring", [834, 1112], async (p) => {
  await p.getByRole("button", { name: "Раскраски" }).click();
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: "Рыжик и его друзья" }).click();
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: /Мишка/ }).first().click();
  await p.waitForSelector(".sheet");
  await p.waitForTimeout(1400);
});
await shot("834-6-reward", [834, 1112], async (p) => {
  await p.getByRole("button", { name: "Раскраски" }).click();
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: "Рыжик и его друзья" }).click();
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: /Мишка/ }).first().click();
  await p.waitForSelector(".sheet");
  await p.waitForTimeout(1400);
  await paint(p);
  await p.getByRole("button", { name: "Готово" }).click();
  await p.waitForTimeout(1000);
});

await browser.close();
console.log(`Скриншоты: ${OUT}`);
