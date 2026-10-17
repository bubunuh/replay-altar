// Builds the desktop app into out/: main + preload with esbuild, the page with Vite.
import { rmSync } from "node:fs";
import { join } from "node:path";
import * as esbuild from "esbuild";
import { build as viteBuild } from "vite";
import react from "@vitejs/plugin-react";

const here = import.meta.dirname;
const out = join(here, "out");
rmSync(out, { recursive: true, force: true });

const common: esbuild.BuildOptions = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron"],
  logLevel: "warning",
};
await esbuild.build({
  ...common,
  entryPoints: [join(here, "src/main.ts")],
  outfile: join(out, "main.cjs"),
  // import.meta.dirname has no CJS equivalent in esbuild's output; map it to __dirname.
  define: { "import.meta.dirname": "__dirname" },
});
await esbuild.build({ ...common, entryPoints: [join(here, "src/preload.ts")], outfile: join(out, "preload.cjs") });

await viteBuild({
  root: join(here, "src/renderer"),
  base: "./",
  plugins: [react()],
  logLevel: "warn",
  build: { outDir: join(out, "renderer"), emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
console.log(`built ${out}`);
