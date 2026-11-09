/**
 * Loads the regions script's TypeScript on Node 20, which has no
 * --experimental-strip-types. Node 22 can use the same hook.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export async function load(url, context, nextLoad) {
  if (!url.endsWith(".ts")) return nextLoad(url, context);
  const source = readFileSync(fileURLToPath(url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: url,
  });
  return { format: "module", source: outputText, shortCircuit: true };
}
