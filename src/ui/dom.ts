export type Child = Node | string | null | undefined | false;

export type ElProps = {
  class?: string;
  text?: string;
  html?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  on?: Record<string, EventListener>;
  style?: Record<string, string>;
  dataset?: Record<string, string>;
};

/** Small element helper. No framework, no virtual DOM, no diffing. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.html !== undefined) node.innerHTML = props.html;
  if (props.attrs) {
    for (const [key, value] of Object.entries(props.attrs)) {
      if (value === null || value === undefined || value === false) continue;
      node.setAttribute(key, value === true ? "" : String(value));
    }
  }
  if (props.dataset) {
    for (const [key, value] of Object.entries(props.dataset)) node.dataset[key] = value;
  }
  if (props.style) Object.assign(node.style, props.style);
  if (props.on) {
    for (const [event, listener] of Object.entries(props.on)) {
      node.addEventListener(event, listener);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function button(
  label: string,
  options: ElProps & { icon?: Node; hint?: string } = {},
): HTMLButtonElement {
  const { icon, hint, ...rest } = options;
  const node = el(
    "button",
    { ...rest, class: rest.class ?? "btn", attrs: { type: "button", ...(rest.attrs ?? {}) } },
    [icon ?? null, el("span", { class: "btn__label", text: label })],
  );
  if (hint) node.setAttribute("aria-label", hint);
  return node;
}
