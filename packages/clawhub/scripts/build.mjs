import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(packageRoot, "dist");

await rm(distDir, { recursive: true, force: true });

const tscBin = require.resolve("typescript/bin/tsc");
const result = spawnSync(process.execPath, [tscBin, "-p", "tsconfig.json"], {
  cwd: packageRoot,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
