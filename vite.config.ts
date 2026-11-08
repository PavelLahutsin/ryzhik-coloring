import { defineConfig } from "vite";

// Production is a GitHub Pages project site. The dev server stays at the
// root so `npm run dev` opens http://localhost:5173 with no extra path.
// Preview serves the already-built files, so it needs the same base.
export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview ? "/ryzhik-coloring/" : "/",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
}));
