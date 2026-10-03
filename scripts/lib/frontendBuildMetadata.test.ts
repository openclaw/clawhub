// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { build } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyticsReleaseDefine,
  DEPLOYMENT_METADATA_PATH,
  parseDeploymentMetadata,
  writeDeploymentMetadata,
} from "./frontendBuildMetadata";

const roots: string[] = [];
function fixture() {
  const base = path.resolve(".artifacts");
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(path.join(base, "frontend-metadata-test-"));
  roots.push(root);
  return root;
}
function runtime(root: string, bytes = Buffer.from([0, 127, 128, 255])) {
  mkdirSync(path.join(root, "assets"), { recursive: true });
  writeFileSync(path.join(root, "assets/runtimeEnv-Abc_123-.js"), bytes);
  return {
    path: "/assets/runtimeEnv-Abc_123-.js",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("unreferenced frontend deployment metadata", () => {
  it("binds the commit to actual asset bytes in node and Vercel outputs deterministically", () => {
    const root = fixture();
    const outputs = [path.join(root, ".output/public"), path.join(root, ".vercel/output/static")];
    const asset = runtime(outputs[0]);
    runtime(outputs[1]);
    const expected = {
      schema_version: 1,
      git_commit_sha: "a".repeat(40),
      runtime_asset: asset,
    };
    expect(writeDeploymentMetadata(` ${"A".repeat(40)} `, outputs)).toEqual(expected);
    const first = readFileSync(path.join(outputs[0], DEPLOYMENT_METADATA_PATH), "utf8");
    expect(parseDeploymentMetadata(JSON.parse(first))).toEqual(expected);
    expect(readFileSync(path.join(outputs[1], DEPLOYMENT_METADATA_PATH), "utf8")).toBe(first);
    writeDeploymentMetadata("a".repeat(40), outputs);
    expect(readFileSync(path.join(outputs[0], DEPLOYMENT_METADATA_PATH), "utf8")).toBe(first);
    expect(writeDeploymentMetadata("b".repeat(40), outputs).runtime_asset).toEqual(asset);
    expect(readFileSync(path.join(outputs[0], asset.path))).toEqual(
      Buffer.from([0, 127, 128, 255]),
    );
  });

  it("does not publish malformed commit values or unrelated environment data", () => {
    const root = fixture();
    runtime(root);
    vi.stubEnv("PRIVATE_SENTINEL", "never-publish");
    for (const commit of [undefined, "", "a".repeat(39), "PRIVATE_SENTINEL=never-publish"]) {
      expect(writeDeploymentMetadata(commit, [root]).git_commit_sha).toBeNull();
      expect(readFileSync(path.join(root, DEPLOYMENT_METADATA_PATH), "utf8")).not.toMatch(
        /PRIVATE_SENTINEL|never-publish/,
      );
    }
  });

  it("fails instead of guessing when an output is absent, ambiguous or inconsistent", () => {
    const root = fixture();
    expect(() => writeDeploymentMetadata(undefined, [path.join(root, "missing")])).toThrow(
      "Frontend static output directory is missing",
    );
    mkdirSync(path.join(root, "assets"));
    expect(() => writeDeploymentMetadata(undefined, [root])).toThrow("exactly one");
    runtime(root);
    writeFileSync(path.join(root, "assets/runtimeEnv-12345678.js"), "stale");
    expect(() => writeDeploymentMetadata(undefined, [root])).toThrow("exactly one");
    rmSync(path.join(root, "assets/runtimeEnv-12345678.js"));
    const second = fixture();
    runtime(second, Buffer.from("different"));
    expect(() => writeDeploymentMetadata(undefined, [root, second])).toThrow("disagree");
  });

  it("accepts only the small closed schema and bounded same-origin asset path", () => {
    const valid = {
      schema_version: 1,
      git_commit_sha: "a".repeat(40),
      runtime_asset: { path: "/assets/runtimeEnv-12345678.js", sha256: "b".repeat(64) },
    };
    expect(parseDeploymentMetadata(valid)).toEqual(valid);
    expect(parseDeploymentMetadata({ ...valid, git_commit_sha: null })).not.toBeNull();
    for (const value of [
      null,
      [],
      "metadata",
      {},
      { ...valid, extra: "value" },
      { ...valid, schema_version: 2 },
      { ...valid, git_commit_sha: "a".repeat(7) },
      { ...valid, runtime_asset: null },
      { ...valid, runtime_asset: [] },
      { ...valid, runtime_asset: { ...valid.runtime_asset, sha256: "invalid" } },
      { ...valid, runtime_asset: { ...valid.runtime_asset, extra: "value" } },
      ...[
        "https://example.com/assets/runtimeEnv-12345678.js",
        "/assets/../runtimeEnv-12345678.js",
        "/assets/runtimeEnv-12345678.js?secret=x",
        "/assets/runtimeEnv-12345678.js#x",
      ].map((assetPath) => ({
        ...valid,
        runtime_asset: { ...valid.runtime_asset, path: assetPath },
      })),
    ])
      expect(parseDeploymentMetadata(value)).toBeNull();
  });

  it("keeps deployment metadata uncacheable in the hosting configuration", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(
      config.headers.find((rule: { source: string }) => rule.source === DEPLOYMENT_METADATA_PATH)
        .headers,
    ).toEqual([
      { key: "Cache-Control", value: "no-store" },
      { key: "CDN-Cache-Control", value: "no-store" },
      { key: "Vercel-CDN-Cache-Control", value: "no-store" },
    ]);
  });
});

it.each(["dotenv", "process"])(
  "Vite makes direct/dynamic retired env reads undefined for %s while preserving other env",
  async (source) => {
    const root = fixture();
    writeFileSync(
      path.join(root, ".env.production"),
      "VITE_GA4_RELEASE=retired-dotenv-sentinel\nVITE_UNRELATED=keep-dotenv\n",
    );
    if (source === "process") {
      vi.stubEnv("VITE_GA4_RELEASE", "retired-process-sentinel");
      vi.stubEnv("VITE_UNRELATED", "keep-process");
    } else {
      vi.stubEnv("VITE_GA4_RELEASE", undefined);
      vi.stubEnv("VITE_UNRELATED", undefined);
    }
    writeFileSync(
      path.join(root, "entry.js"),
      [
        "export const direct = import.meta.env.VITE_GA4_RELEASE;",
        "export function read(key) { return import.meta.env[key]; }",
      ].join("\n"),
    );
    const result = await build({
      configFile: false,
      root,
      envDir: root,
      mode: "production",
      logLevel: "silent",
      define: analyticsReleaseDefine,
      build: {
        write: false,
        minify: false,
        lib: { entry: path.join(root, "entry.js"), name: "Fixture", formats: ["iife"] },
      },
    });
    const bundles = Array.isArray(result) ? result : [result];
    const code = bundles
      .flatMap((bundle) => ("output" in bundle ? bundle.output : []))
      .map((output) => (output.type === "chunk" ? output.code : ""))
      .join("\n");
    expect(code).not.toMatch(/retired-(dotenv|process)-sentinel/);
    const sandbox = {} as { Fixture: { direct: unknown; read: (key: string) => unknown } };
    runInNewContext(code, sandbox);
    expect(sandbox.Fixture.direct).toBeUndefined();
    expect(sandbox.Fixture.read("VITE_GA4_RELEASE")).toBeUndefined();
    expect(sandbox.Fixture.read("VITE_UNRELATED")).toBe(`keep-${source}`);
  },
);
