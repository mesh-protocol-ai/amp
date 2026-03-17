import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const source = path.join(root, "proto");
const target = path.join(root, "dist", "proto");

if (!fs.existsSync(source)) {
  throw new Error(`Proto source directory not found: ${source}`);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(source, target, { recursive: true });
console.log(`Copied proto files: ${source} -> ${target}`);
