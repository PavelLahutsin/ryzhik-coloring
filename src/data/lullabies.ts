import raw from "./lullabies.json";

export type LullabyEntry = { id: string; title: string; file: string };
export type Lullaby = LullabyEntry & { url: string };

/**
 * Every mp3 in assets/audio/lullabies, resolved at build time so the lullabies
 * work offline. Adding a file is one step: copy the mp3 in and add a row to
 * lullabies.json. Rows whose file is missing are skipped, never played.
 */
const files = import.meta.glob<string>("../assets/audio/lullabies/*.mp3", {
  eager: true,
  query: "?url",
  import: "default",
});

const urlByFile = new Map<string, string>();
for (const [path, url] of Object.entries(files)) {
  const name = path.split("/").pop();
  if (name) urlByFile.set(name, url);
}

export const lullabies: Lullaby[] = (raw as LullabyEntry[]).flatMap((entry) => {
  const url = urlByFile.get(entry.file);
  return url ? [{ ...entry, url }] : [];
});
