import { copyFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const outputDir = fileURLToPath(new URL("../dist/", import.meta.url));
const names = await readdir(outputDir);
const sourceName = ["index.js", "index.mjs", "worker.js", "worker.mjs"].find((name) => names.includes(name));
if (!sourceName) throw new Error(`No Wrangler JavaScript bundle found in ${outputDir}`);
const source = join(outputDir, sourceName);
const target = join(outputDir, "worker.js");
if (source !== target) await copyFile(source, target);
console.log(`Dashboard bundle ready: ${target}`);
