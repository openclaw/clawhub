import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const tscBin = require.resolve("typescript/bin/tsc");
const result = spawnSync(process.execPath, [tscBin, "-p", "tsconfig.json", "--noEmit"], {
  cwd: packageRoot,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
