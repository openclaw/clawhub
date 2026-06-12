#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, "dist", "docs-site");
const target = path.join(root, "public", "docs");

if (!fs.existsSync(source)) {
  throw new Error("dist/docs-site does not exist; run docs:build first");
}

fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(source, target, { recursive: true });
console.log(`copied ${path.relative(root, source)} to ${path.relative(root, target)}`);
