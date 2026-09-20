import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceFiles = [path.join(projectRoot, "app.js")];
const moduleDirectory = path.join(projectRoot, "js");

for (const file of await readdir(moduleDirectory)) {
  if (file.endsWith(".js")) sourceFiles.push(path.join(moduleDirectory, file));
}

for (const file of sourceFiles) {
  const source = await readFile(file, "utf8");
  await transform(source, { loader: "js", format: "esm", logLevel: "error" });
}

console.log(`JavaScript syntax check passed: ${sourceFiles.length} files`);
