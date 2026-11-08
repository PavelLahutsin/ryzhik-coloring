/**
 * Hold-to-confirm button. The design document replaces the "Стереть рисунок?"
 * dialog with a 1.2 s press and a filling ring: a child who cannot read still
 * understands it, and a stray tap cannot wipe the picture.
 */
export type HoldOptions = {
  /** ms of continuous press before the action fires. */
  duration?: number;
  onHold: () => void;
  /** A tap that was released before the hold finished. */
  onShort?: () => void;
  label: string;
  icon: Node;
};

const RING = 2 * Math.PI * 22;

export function holdButton(options: HoldOptions): HTMLButtonElement {
  const duration = options.duration ?? 1200;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "tool tool--hold";
  button.setAttribute("aria-label", `${options.label}: нажми и держи`);
  button.innerHTML =
    `<svg class="hold__ring" viewBox="0 0 48 48" aria-hidden="true" focusable="false">` +
    `<circle class="hold__track" cx="24" cy="24" r="22"/>` +
    `<circle class="hold__value" cx="24" cy="24" r="22" stroke-dasharray="${RING}" stroke-dashoffset="${RING}"/>` +
    `</svg>`;
  button.append(options.icon);
  button.append(
    Object.assign(document.createElement("span"), { className: "tool__label", textContent: options.label }),
  );

  const value = button.querySelector<SVGCircleElement>(".hold__value");
  let raf = 0;
  let startedAt = 0;
  let fired = false;

  const stop = (reset = true): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    button.classList.remove("is-holding");
    if (reset && value) {
      value.style.strokeDashoffset = String(RING);
      button.classList.remove("is-done");
    }
  };

  const tick = (): void => {
    const elapsed = performance.now() - startedAt;
    const ratio = Math.min(1, elapsed / duration);
    if (value) value.style.strokeDashoffset = String(RING * (1 - ratio));
    if (ratio >= 1) {
      fired = true;
      stop(false);
      button.classList.add("is-done");
      window.setTimeout(() => button.classList.remove("is-done"), 260);
      options.onHold();
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (raf) return;
    fired = false;
    startedAt = performance.now();
    button.classList.add("is-holding");
    button.setPointerCapture?.(event.pointerId);
    raf = requestAnimationFrame(tick);
  });

  const cancel = (): void => {
    const releasedEarly = raf !== 0 && !fired;
    if (fired) return;
    stop();
    if (releasedEarly) options.onShort?.();
  };
  button.addEventListener("pointerup", cancel);
  button.addEventListener("pointercancel", cancel);
  button.addEventListener("pointerleave", cancel);
  button.addEventListener("contextmenu", (event) => event.preventDefault());

  // Keyboard users get the same protection: hold Enter or Space.
  button.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && !raf && !event.repeat) {
      event.preventDefault();
      startedAt = performance.now();
      button.classList.add("is-holding");
      raf = requestAnimationFrame(tick);
    }
  });
  button.addEventListener("keyup", cancel);
  button.addEventListener("blur", cancel);

  return button;
}
