import { spawnSync } from "node:child_process";
import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const schemaRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../schema");
const schemaDist = resolve(schemaRoot, "dist");
const sharedSchemaModules = [
  "ark",
  "openclawContract",
  "packageShared",
  "packageUploadLimits",
  "pluginInput",
  "schemaShared",
  "templateAgent",
  "templateBundled",
  "templateManifestSummary",
  "templatePackage",
  "templatePaths",
  "templates",
  "textFiles",
];

function buildSharedSchema(tscBin) {
  const result = spawnSync(process.execPath, [tscBin, "-p", "tsconfig.json"], {
    cwd: schemaRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function copySharedSchemaArtifacts(destination) {
  // Ship implementations at the existing paths, never the workspace-only forwarders.
  for (const name of sharedSchemaModules) {
    for (const extension of [".js", ".d.ts"]) {
      await copyFile(resolve(schemaDist, name + extension), resolve(destination, name + extension));
    }

    const targetMap = resolve(destination, name + ".js.map");
    const sourceMap = JSON.parse(await readFile(resolve(schemaDist, name + ".js.map"), "utf8"));
    const sources = sourceMap.sources.map((source) =>
      resolve(schemaDist, sourceMap.sourceRoot ?? "", source),
    );
    sourceMap.sourceRoot = "";
    sourceMap.sources = sources.map((source) =>
      relative(dirname(targetMap), source).split(sep).join("/"),
    );
    sourceMap.sourcesContent = await Promise.all(sources.map((source) => readFile(source, "utf8")));
    await writeFile(targetMap, JSON.stringify(sourceMap) + "\n");
  }
}

export async function buildCliPackage(scriptUrl, schemaSubdirectory) {
  const require = createRequire(scriptUrl);
  const packageRoot = resolve(dirname(fileURLToPath(scriptUrl)), "..");
  const distDir = resolve(packageRoot, "dist");

  const tscBin = resolve(dirname(require.resolve("@typescript/native/package.json")), "bin/tsc");
  buildSharedSchema(tscBin);
  await rm(distDir, { recursive: true, force: true });

  const result = spawnSync(process.execPath, [tscBin, "-p", "tsconfig.json"], {
    cwd: packageRoot,
    stdio: "inherit",
  });

  if (result.status !== 0) process.exit(result.status ?? 1);

  await copySharedSchemaArtifacts(resolve(distDir, schemaSubdirectory));
}
