import "@fontsource/comfortaa/cyrillic-700.css";
import "@fontsource/comfortaa/latin-700.css";
import "@fontsource/nunito/cyrillic-400.css";
import "@fontsource/nunito/cyrillic-800.css";
import "@fontsource/nunito/latin-400.css";
import "@fontsource/nunito/latin-800.css";
import linePng from "./assets/ryzhik-i-medved.png?url";
import lineSvg from "./assets/ryzhik-i-medved.svg?url";
import { ColoringBook, type Tool } from "./engine";
import "./style.css";

const COLORS = [
  { name: "Оранжевый", hex: "#ff8a3d" },
  { name: "Персиковый", hex: "#ffb07a" },
  { name: "Жёлтый", hex: "#ffc94a" },
  { name: "Зелёный", hex: "#3cbf4a" },
  { name: "Изумрудный", hex: "#1e8e71" },
  { name: "Красный", hex: "#ff4b4b" },
  { name: "Розовый", hex: "#ff7eb6" },
  { name: "Фиолетовый", hex: "#a878ff" },
  { name: "Синий", hex: "#4c8dff" },
  { name: "Голубой", hex: "#63d2ff" },
  { name: "Коричневый", hex: "#a56a3c" },
  { name: "Белый", hex: "#ffffff" },
  { name: "Чёрный", hex: "#2a211c" },
];

const HINTS: Record<Tool, string> = {
  fill: "Нажми на область, чтобы закрасить её",
  pencil: "Карандаш рисует линию",
  brush: "Мягкая круглая кисть",
  marker: "Фломастер чуть прозрачный",
  eraser: "Ластик стирает краску. Линии остаются",
};

const DEFAULT_SIZE: Record<Exclude<Tool, "fill">, number> = {
  pencil: 10,
  brush: 28,
  marker: 26,
  eraser: 30,
};

function must<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Нет элемента ${selector}`);
  return node;
}

const sheet = must<HTMLCanvasElement>("#sheet");
const stage = must<HTMLElement>("#stage");
const loading = must<HTMLElement>("#loading");
const hint = must<HTMLElement>("#hint");
const colorsEl = must<HTMLElement>("#colors");
const sizeInput = must<HTMLInputElement>("#size");
const sizeDot = must<HTMLElement>("#size-dot");
const clipInput = must<HTMLInputElement>("#clip");
const undoBtn = must<HTMLButtonElement>("#undo");
const redoBtn = must<HTMLButtonElement>("#redo");
const clearBtn = must<HTMLButtonElement>("#clear");
const saveBtn = must<HTMLButtonElement>("#save");
const dialog = must<HTMLDialogElement>("#dialog");
const toast = must<HTMLElement>("#toast");

const book = new ColoringBook(sheet, stage);
let color = COLORS[0].hex;
let tool: Tool = "fill";
const sizes = { ...DEFAULT_SIZE };
let toastTimer = 0;

function showToast(text: string): void {
  toast.textContent = text;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 2200);
}

function paintDot(): void {
  const px = Number(sizeInput.value);
  sizeDot.style.width = `${px}px`;
  sizeDot.style.height = `${px}px`;
  sizeDot.style.background = tool === "eraser" ? "#fff" : color;
}

function syncHistory(): void {
  undoBtn.disabled = !book.canUndo;
  redoBtn.disabled = !book.canRedo;
}

function selectTool(next: Tool): void {
  tool = next;
  book.setTool(next);
  hint.textContent = HINTS[next];
  for (const button of document.querySelectorAll<HTMLButtonElement>(".tool")) {
    button.setAttribute("aria-pressed", String(button.dataset.tool === next));
  }
  const drawing = next !== "fill";
  sizeInput.disabled = !drawing;
  if (drawing) {
    sizeInput.value = String(sizes[next]);
    book.setSize(sizes[next]);
  }
  paintDot();
}

function selectColor(hex: string): void {
  color = hex;
  book.setColor(hex);
  for (const swatch of colorsEl.querySelectorAll<HTMLButtonElement>(".swatch")) {
    swatch.setAttribute("aria-pressed", String(swatch.dataset.color === hex));
  }
  paintDot();
}

for (const entry of COLORS) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "swatch";
  button.dataset.color = entry.hex;
  button.style.background = entry.hex;
  button.setAttribute("role", "option");
  button.setAttribute("aria-label", entry.name);
  button.setAttribute("aria-pressed", String(entry.hex === color));
  button.addEventListener("click", () => selectColor(entry.hex));
  colorsEl.append(button);
}

for (const button of document.querySelectorAll<HTMLButtonElement>(".tool")) {
  button.addEventListener("click", () => {
    const next = button.dataset.tool;
    if (next === "fill" || next === "pencil" || next === "brush" || next === "marker" || next === "eraser") {
      selectTool(next);
    }
  });
}

sizeInput.addEventListener("input", () => {
  const value = Number(sizeInput.value);
  if (tool !== "fill") sizes[tool] = value;
  book.setSize(value);
  paintDot();
});

clipInput.addEventListener("change", () => {
  book.setClip(clipInput.checked);
});

undoBtn.addEventListener("click", () => book.undo());
redoBtn.addEventListener("click", () => book.redo());
clearBtn.addEventListener("click", () => {
  if (!book.hasPaint()) {
    showToast("Пока нечего стирать");
    return;
  }
  dialog.showModal();
});

dialog.addEventListener("close", () => {
  if (dialog.returnValue === "clear") book.clear();
});

saveBtn.addEventListener("click", () => {
  void book.save("raskraska-ryzhik.png").then((ok) => {
    if (ok) showToast("Картинка сохранена");
  });
});

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (!(event.ctrlKey || event.metaKey) || event.key === "Control") return;
  if (key === "z" && event.shiftKey) {
    event.preventDefault();
    book.redo();
  } else if (key === "z") {
    event.preventDefault();
    book.undo();
  } else if (key === "y") {
    event.preventDefault();
    book.redo();
  }
});

book.onHistory = () => {
  syncHistory();
};

book.setColor(color);
book.setClip(true);
selectTool("fill");
syncHistory();

void book.load(lineSvg, linePng).then(
  () => {
    loading.hidden = true;
    document.body.dataset.ready = "1";
  },
  () => {
    loading.textContent = "Не получилось открыть рисунок. Обновите страницу.";
  },
);
