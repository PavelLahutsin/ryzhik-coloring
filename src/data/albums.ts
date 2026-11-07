import albumsJson from "./albums.json";

/**
 * Album data lives in one JSON file: album -> pictures. Adding a picture means
 * dropping `src/assets/pictures/<id>.svg` (and an optional `<id>.png` fallback),
 * one entry here, then `npm run regions` for the QA report.
 */
export type PictureEntry = {
  id: string;
  title: string;
};

export type AlbumEntry = {
  id: string;
  title: string;
  /** Decorative letter shown on the cover when no picture art is available. */
  emoji?: string;
  /** Picture id used for the cover thumbnail. */
  cover?: string | null;
  /** False for albums that are announced but not shipped yet. */
  available: boolean;
  pictures: PictureEntry[];
};

export type Catalog = {
  version: number;
  albums: AlbumEntry[];
};

export type PictureArt = {
  svg: string;
  /** Raster fallback used when the traced SVG fails to load. */
  png?: string;
};

export const catalog = albumsJson as Catalog;

/**
 * Vite resolves these at build time, so the picture art is part of the bundle
 * and the app works offline. `import.meta.glob` keeps the JSON the single
 * source of truth for ids.
 */
const svgFiles = import.meta.glob<string>("../assets/pictures/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});
const pngFiles = import.meta.glob<string>(
  ["../assets/pictures/*.png", "!../assets/pictures/*.regions.png"],
  {
    eager: true,
    query: "?url",
    import: "default",
  },
);

function byName(files: Record<string, string>, ext: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const [path, url] of Object.entries(files)) {
    const name = path.split("/").pop();
    if (!name) continue;
    map.set(name.slice(0, -ext.length), url);
  }
  return map;
}

const svgUrls = byName(svgFiles, ".svg");
const pngUrls = byName(pngFiles, ".png");

export function artFor(pictureId: string): PictureArt | null {
  const svg = svgUrls.get(pictureId);
  const png = pngUrls.get(pictureId);
  if (!svg && !png) return null;
  return { svg: svg ?? png ?? "", png };
}

export function findAlbum(albumId: string): AlbumEntry | null {
  return catalog.albums.find((album) => album.id === albumId) ?? null;
}

export function findPicture(albumId: string, pictureId: string): PictureEntry | null {
  return findAlbum(albumId)?.pictures.find((picture) => picture.id === pictureId) ?? null;
}

/** Album that owns a picture, so S4 and S5 always know where to go back to. */
export function albumOfPicture(pictureId: string): AlbumEntry | null {
  for (const album of catalog.albums) {
    if (album.pictures.some((picture) => picture.id === pictureId)) return album;
  }
  return null;
}

export function shippedAlbums(): AlbumEntry[] {
  return catalog.albums.filter((album) => album.available && album.pictures.length > 0);
}
