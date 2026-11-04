import { describe, expect, it } from "vitest";
import { validateOpenClawExternalCodePluginPackageContents } from "./openclawContract.js";

function packageJson(openclaw: Record<string, unknown>) {
  return {
    name: "demo-plugin",
    version: "1.0.0",
    openclaw: {
      compat: { pluginApi: ">=2026.3.24" },
      build: { openclawVersion: "2026.3.24" },
      ...openclaw,
    },
  };
}

function messages(openclaw: Record<string, unknown>, files: string[]) {
  return validateOpenClawExternalCodePluginPackageContents(packageJson(openclaw), [
    "package.json",
    "openclaw.plugin.json",
    ...files,
  ]).issues.map((issue) => issue.message);
}

describe("OpenClaw declared entrypoint validation", () => {
  it("accepts packages whose declared entries are present the way OpenClaw loads them", () => {
    expect(messages({ extensions: ["./dist/index.js"] }, ["dist/index.js"])).toEqual([]);
    expect(messages({ extensions: ["./src/index.ts"] }, ["src/index.ts", "dist/index.js"])).toEqual(
      [],
    );
    // TypeScript can keep src/ under dist/ when rootDir is the package root.
    expect(messages({ extensions: ["./src/index.ts"] }, ["dist/src/index.js"])).toEqual([]);
    expect(messages({ extensions: ["./index.mts"] }, ["dist/index.mjs"])).toEqual([]);
    expect(
      messages({ extensions: ["./src/index.ts"], runtimeExtensions: ["./build/plugin.js"] }, [
        "build/plugin.js",
      ]),
    ).toEqual([]);
    expect(
      messages(
        {
          extensions: ["./dist/index.js"],
          setupEntry: "./src/setup.ts",
          runtimeSetupEntry: "./dist/setup.js",
        },
        ["dist/index.js", "dist/setup.js"],
      ),
    ).toEqual([]);
    expect(messages({ extensions: ["dist\\index.js"] }, ["dist/index.js"])).toEqual([]);
    expect(messages({ extensions: ["./lib/../dist/index.js"] }, ["dist/index.js"])).toEqual([]);
  });

  it("does not require entries a package does not declare", () => {
    expect(messages({}, ["index.js"])).toEqual([]);
  });

  it("rejects a declared JavaScript extension missing from the upload", () => {
    expect(messages({ extensions: ["./dist/index.js"] }, ["src/index.ts"])).toEqual([
      "demo-plugin declares openclaw.extensions entry ./dist/index.js, but that file is missing from the package. OpenClaw cannot load this plugin without it. Build first and publish a local folder or .tgz, or include the runtime file in the GitHub ref. Otherwise update package.json openclaw.extensions to point at a published file.",
    ]);
  });

  it("rejects TypeScript extensions without compiled output", () => {
    const [message] = messages({ extensions: ["./src/index.ts"] }, ["src/index.ts"]);
    expect(message).toContain(
      "demo-plugin requires compiled runtime output for TypeScript entry ./src/index.ts: expected ./dist/index.js",
    );
    expect(message).toContain("./dist/src/index.js");
  });

  it("rejects missing runtime extensions even when the source entry exists", () => {
    expect(
      messages({ extensions: ["./src/index.ts"], runtimeExtensions: ["./dist/index.js"] }, [
        "src/index.ts",
      ]),
    ).toEqual([
      "demo-plugin declares openclaw.runtimeExtensions entry ./dist/index.js, but that file is missing from the package. Build first and publish a local folder or .tgz, or include the runtime file in the GitHub ref.",
    ]);
  });

  it("rejects missing setup entries and runtime setup entries", () => {
    expect(
      messages({ extensions: ["./dist/index.js"], setupEntry: "./dist/setup.js" }, [
        "dist/index.js",
      ]),
    ).toEqual([expect.stringContaining("openclaw.setupEntry entry ./dist/setup.js")]);
    expect(
      messages(
        {
          extensions: ["./dist/index.js"],
          setupEntry: "./src/setup.ts",
          runtimeSetupEntry: "./dist/setup.js",
        },
        ["dist/index.js", "src/setup.ts"],
      ),
    ).toEqual([expect.stringContaining("openclaw.runtimeSetupEntry entry ./dist/setup.js")]);
    expect(
      messages({ extensions: ["./dist/index.js"], runtimeSetupEntry: "./dist/setup.js" }, [
        "dist/index.js",
        "dist/setup.js",
      ]),
    ).toEqual([
      "demo-plugin declares openclaw.runtimeSetupEntry without openclaw.setupEntry. OpenClaw requires openclaw.setupEntry whenever openclaw.runtimeSetupEntry is set.",
    ]);
  });

  it("rejects entries that point outside the package", () => {
    expect(messages({ extensions: ["../shared/index.js"] }, ["index.js"])).toEqual([
      "demo-plugin declares openclaw.extensions entry ../shared/index.js, which points outside the package. Point it at a file inside the published package.",
    ]);
  });

  it("reports each missing runtime file when runtime and source lists differ in length", () => {
    expect(
      messages(
        {
          extensions: ["./src/a.ts", "./src/b.ts"],
          runtimeExtensions: ["./dist/a.js"],
        },
        ["src/a.ts", "src/b.ts"],
      ),
    ).toEqual([
      "demo-plugin openclaw.runtimeExtensions length (1) must match openclaw.extensions length (2).",
      expect.stringContaining("openclaw.runtimeExtensions entry ./dist/a.js"),
    ]);
  });
});
