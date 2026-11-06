/**
 * Hash routing, no library. The hash keeps the app working from any base path
 * (GitHub Pages serves this repo from /ryzhik-coloring/), so links never need
 * to know where the bundle is mounted.
 */
export type Route =
  | { name: "menu" }
  | { name: "albums" }
  | { name: "album"; albumId: string }
  | { name: "picture"; pictureId: string }
  | { name: "reward"; pictureId: string }
  | { name: "drawings" }
  | { name: "sound" }
  | { name: "gate"; next: string }
  | { name: "parent" }
  | { name: "missing" };

const FALLBACK = "/";

function segments(hash: string): string[] {
  return hash
    .replace(/^#/, "")
    .split("/")
    .filter(Boolean);
}

export function parseRoute(hash: string): Route {
  const [head, ...rest] = segments(hash);
  switch (head) {
    case undefined:
    case "":
    case "menu":
      return { name: "menu" };
    case "albums":
      return { name: "albums" };
    case "album":
      return rest[0] ? { name: "album", albumId: rest[0] } : { name: "albums" };
    case "picture":
      return rest[0] ? { name: "picture", pictureId: rest[0] } : { name: "albums" };
    case "reward":
      return rest[0] ? { name: "reward", pictureId: rest[0] } : { name: "menu" };
    case "drawings":
      return { name: "drawings" };
    case "sound":
      return { name: "sound" };
    case "gate":
      return { name: "gate", next: rest[0] ?? "parent" };
    case "parent":
      return { name: "parent" };
    default:
      return { name: "missing" };
  }
}

/** Path without the leading hash, e.g. "/album/friends". */
export function href(path: string): string {
  return `#${path.startsWith("/") ? path : `/${path}`}`;
}

export function navigate(path: string): void {
  const next = href(path);
  if (window.location.hash === next) {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return;
  }
  window.location.hash = next;
}

export function currentRoute(): Route {
  return parseRoute(window.location.hash);
}

export function startRouter(onRoute: (route: Route) => void): () => void {
  if (!window.location.hash) {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${FALLBACK}`);
  }
  const handler = (): void => onRoute(currentRoute());
  window.addEventListener("hashchange", handler);
  onRoute(currentRoute());
  return () => window.removeEventListener("hashchange", handler);
}
