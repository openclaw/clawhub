/* @vitest-environment node */
import path from "node:path";
import { build, type Metafile } from "esbuild";
import { describe, expect, it } from "vitest";

// Convex evaluates a function's whole module, with everything it imports statically, each time
// the function runs uncached. Constructing the ArkType schemas costs roughly 0.4 s, so modules
// that serve reads must reach them only through `await import()` in the paths that validate.
const READ_PATH_MODULES = [
  "convex/githubImport.ts",
  "convex/githubSkillSync.ts",
  "convex/lib/githubImport.ts",
  "convex/lib/githubSkillSync.ts",
  "convex/lib/skillPresentationBackfill.ts",
  "convex/packageReadHttp.ts",
  "convex/packages.ts",
  "convex/publishAttempts.ts",
  "convex/schema.ts",
  "convex/skills.ts",
];

async function staticImportChainTo(entry: string, isTarget: (file: string) => boolean) {
  const result = await build({
    entryPoints: [path.resolve(entry)],
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
    metafile: true,
    logLevel: "silent",
    external: ["node:*"],
  });
  const inputs: Metafile["inputs"] = result.metafile.inputs;
  const importedBy = new Map<string, string>();
  const pending = [entry];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const file = pending.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (isTarget(file)) {
      const chain = [file];
      for (let at = importedBy.get(file); at; at = importedBy.get(at)) chain.unshift(at);
      return chain.filter((step) => !step.includes("node_modules/@ark/"));
    }
    for (const dependency of inputs[file]?.imports ?? []) {
      // Dynamic imports load on demand; only static edges are evaluated with the module.
      if (dependency.external || dependency.kind === "dynamic-import") continue;
      if (!importedBy.has(dependency.path)) importedBy.set(dependency.path, file);
      pending.push(dependency.path);
    }
  }
  return null;
}

describe("schema validation library imports", () => {
  it.each(READ_PATH_MODULES)(
    "%s does not statically import ArkType",
    async (entry) => {
      const chain = await staticImportChainTo(entry, (file) =>
        file.includes("node_modules/arktype/"),
      );
      expect(chain, `static import chain: ${chain?.join(" -> ")}`).toBeNull();
    },
    60_000,
  );

  it("detects a module that does import it", async () => {
    const chain = await staticImportChainTo("convex/httpApiV1/packagesV1.ts", (file) =>
      file.includes("node_modules/arktype/"),
    );
    expect(chain?.[0]).toBe("convex/httpApiV1/packagesV1.ts");
  }, 60_000);
});

const HASH_ONLY_MODULES = [
  "convex/catalogFeed.ts",
  "convex/managedMcp.ts",
  "convex/pluginCategoryRefresh.ts",
  "convex/promotionsFeed.ts",
  "convex/skillPresentationBackfill.ts",
  "convex/lib/packageClawpackPublish.ts",
];

describe("hash-only archive imports", () => {
  it.each(HASH_ONLY_MODULES)(
    "%s does not statically import the archive parser",
    async (entry) => {
      const chain = await staticImportChainTo(
        entry,
        (file) => file === "packages/clawhub/src/clawpack.ts",
      );
      expect(chain, `static import chain: ${chain?.join(" -> ")}`).toBeNull();
    },
    60_000,
  );

  it("detects an archive parsing consumer", async () => {
    const chain = await staticImportChainTo(
      "convex/lib/templateDisplayArchive.ts",
      (file) => file === "packages/clawhub/src/clawpack.ts",
    );
    expect(chain?.[0]).toBe("convex/lib/templateDisplayArchive.ts");
  }, 60_000);
});
