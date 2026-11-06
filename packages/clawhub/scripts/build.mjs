import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSharedSchema, copySharedSchemaArtifacts } from "./shared-schema.mjs";

const require = createRequire(import.meta.url);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(packageRoot, "dist");

const tscBin = resolve(dirname(require.resolve("@typescript/native/package.json")), "bin/tsc");
buildSharedSchema(tscBin);
await rm(distDir, { recursive: true, force: true });

const result = spawnSync(process.execPath, [tscBin, "-p", "tsconfig.json"], {
  cwd: packageRoot,
  stdio: "inherit",
});

if (result.status !== 0) process.exit(result.status ?? 1);

await copySharedSchemaArtifacts(resolve(distDir, "schema"));
