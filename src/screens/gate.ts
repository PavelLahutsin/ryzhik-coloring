import { navigate } from "../router";
import { el } from "../ui/dom";
import { icon } from "../ui/icons";

/**
 * S8. Parental gate. Three tries, then a 30 s cooldown that survives a reload
 * inside the same tab. Nothing of the adult section is visible behind it.
 *
 * This unlocks the session only in memory: closing the app re-locks.
 */
const MAX_TRIES = 3;
const COOLDOWN_MS = 30_000;
const STORE_KEY = "ryzhik:gate";

type GateState = { fails: number; blockedUntil: number };

type Task = { text: string; answer: number };

let unlocked = false;

export function isParentUnlocked(): boolean {
  return unlocked;
}

export function lockParent(): void {
  unlocked = false;
}

function readState(): GateState {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return { fails: 0, blockedUntil: 0 };
    const parsed = JSON.parse(raw) as GateState;
    return { fails: parsed.fails ?? 0, blockedUntil: parsed.blockedUntil ?? 0 };
  } catch {
    return { fails: 0, blockedUntil: 0 };
  }
}

function writeState(state: GateState): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* Cooldown is a nicety; the gate still works without it. */
  }
}

/** Two-digit addition or a multiplication that is not a rote table fact. */
function makeTask(): Task {
  const multiply = Math.random() < 0.5;
  if (multiply) {
    const a = 3 + Math.floor(Math.random() * 7);
    const b = 3 + Math.floor(Math.random() * 7);
    const answer = a * b;
    if (answer >= 20) return { text: `${a} × ${b} = ?`, answer };
    return { text: `${7} × ${4} = ?`, answer: 28 };
  }
  const a = 11 + Math.floor(Math.random() * 19);
  const b = 4 + Math.floor(Math.random() * 15);
  return { text: `${a} + ${b} = ?`, answer: a + b };
}

export function renderGate(root: HTMLElement, next: string): () => void {
  let state = readState();
  let task = makeTask();
  let input = "";
  let timer = 0;

  const question = el("p", { class: "gate__question", text: task.text });
  const answerBox = el("input", {
    class: "gate__answer",
    attrs: {
      type: "text",
      inputmode: "numeric",
      pattern: "[0-9]*",
      enterkeyhint: "done",
      autocomplete: "off",
      autocorrect: "off",
      maxlength: "4",
      placeholder: "Ответ",
      "aria-label": "Ответ",
    },
  }) as HTMLInputElement;
  const feedback = el("p", { class: "gate__feedback", attrs: { role: "status" } });
  const keypad = el("div", { class: "gate__keypad" });

  const showAnswer = (): void => {
    if (answerBox.value !== input) answerBox.value = input;
  };

  const render = (): void => {
    const blocked = state.blockedUntil > Date.now();
    answerBox.disabled = blocked;
    keypad.replaceChildren();
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "ok"];
    for (const key of keys) {
      const isBack = key === "back";
      const isOk = key === "ok";
      const btn = el(
        "button",
        {
          class: `gate__key${isOk ? " gate__key--ok" : ""}`,
          attrs: {
            type: "button",
            disabled: blocked,
            "aria-label": isBack ? "Стереть" : isOk ? "Проверить" : key,
          },
          on: {
            // pointerup, not click: a phone often swallows the click after the
            // keypad is redrawn, so the digit never appears.
            pointerup: (event) => {
              event.preventDefault();
              press(key);
            },
          },
        },
        [
          isBack
            ? icon("back", 26)
            : isOk
              ? icon("check", 26)
              : el("span", { class: "gate__digit", text: key }),
        ],
      );
      keypad.append(btn);
    }
    showAnswer();
    const seconds = Math.ceil((state.blockedUntil - Date.now()) / 1000);
    feedback.textContent = blocked
      ? `Попробуйте через ${seconds} с`
      : state.fails > 0
        ? `Неверно. Осталось попыток: ${MAX_TRIES - state.fails}`
        : "";
  };

  const press = (key: string): void => {
    if (state.blockedUntil > Date.now()) return;
    input = answerBox.value.replace(/\D/g, "").slice(0, 4);
    if (key === "back") {
      input = input.slice(0, -1);
    } else if (key === "ok") {
      if (Number(input) === task.answer) {
        unlocked = true;
        writeState({ fails: 0, blockedUntil: 0 });
        // Replace the gate so Back does not land on the question again.
        navigate(next.startsWith("/") ? next : `/${next}`, { replace: true });
        return;
      }
      input = "";
      state = { fails: state.fails + 1, blockedUntil: 0 };
      if (state.fails >= MAX_TRIES) {
        state = { fails: 0, blockedUntil: Date.now() + COOLDOWN_MS };
        // The cooldown outlives a reload: a child who reloads must not get a
        // fresh set of tries.
        writeState(state);
        window.clearInterval(timer);
        timer = window.setInterval(render, 1000);
      } else {
        writeState(state);
      }
      task = makeTask();
      question.textContent = task.text;
    } else if (input.length < 4) {
      input += key;
    }
    render();
  };

  answerBox.addEventListener("input", () => {
    input = answerBox.value.replace(/\D/g, "").slice(0, 4);
    if (answerBox.value !== input) answerBox.value = input;
  });
  answerBox.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      press("ok");
    }
  });

  const view = el("div", { class: "screen screen--gate" }, [
    el(
      "header",
      { class: "gate__head" },
      [
        el(
          "button",
          {
            class: "gate__close",
            attrs: { type: "button", "aria-label": "Закрыть" },
            on: { click: () => navigate("/menu") },
          },
          [icon("back", 26)],
        ),
      ],
    ),
    el("h1", { class: "gate__title", text: "Этот раздел для взрослых" }),
    el("p", { class: "gate__lead", text: "Сколько будет" }),
    question,
    answerBox,
    keypad,
    feedback,
  ]);
  root.append(view);
  render();

  return () => window.clearInterval(timer);
}
