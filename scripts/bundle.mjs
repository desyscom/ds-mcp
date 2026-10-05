// Empacota o servidor MCP e os hooks em arquivos únicos: o plugin roda sem node_modules.
import { build } from "esbuild";

await build({
  entryPoints: { index: "src/index.ts", hook: "src/hook.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // dependências CJS (gray-matter/js-yaml) precisam de require dentro do bundle ESM
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "info",
});
