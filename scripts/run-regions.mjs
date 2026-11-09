/**
 * `npm run regions` on Node 20 and Node 22.
 * Node 22's --experimental-strip-types flag is not in Node 20, so the
 * TypeScript files are transpiled with the typescript package already used
 * by the build.
 */
import { register } from "node:module";

await register(new URL("./ts-loader.mjs", import.meta.url).href, import.meta.url);
await import("./regions.test.ts");
await import("./regions.ts");
