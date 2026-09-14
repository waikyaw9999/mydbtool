import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "electron", "dist");

fs.mkdirSync(outDir, { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: true,
};

await esbuild.build({
  ...common,
  entryPoints: [path.join(root, "electron", "main.ts")],
  outfile: path.join(outDir, "main.js"),
});

await esbuild.build({
  ...common,
  entryPoints: [path.join(root, "electron", "preload.ts")],
  outfile: path.join(outDir, "preload.js"),
});

fs.copyFileSync(path.join(root, "electron", "splash.html"), path.join(outDir, "splash.html"));
