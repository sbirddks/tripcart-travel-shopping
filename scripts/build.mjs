import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "dist");

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

await build({
  entryPoints: [
    path.join(projectRoot, "app.js"),
    path.join(projectRoot, "styles.css")
  ],
  bundle: true,
  minify: true,
  format: "esm",
  outdir: outputDirectory,
  entryNames: "[name]",
  sourcemap: true,
  target: "es2020",
  legalComments: "none",
  logLevel: "info"
});

await cp(path.join(projectRoot, "index.html"), path.join(outputDirectory, "index.html"));
await cp(path.join(projectRoot, "data"), path.join(outputDirectory, "data"), { recursive: true });

console.log(`發布檔案已建立：${outputDirectory}`);
