/* @vitest-environment node */

import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeBatch,
  prepareExtractedPluginRoot,
  prepareBulkOpenClawTarget,
  resolveNightlyOpenClawTarget,
  resolveScanRunId,
  renderImpactMarkdown,
  normalizeFindings,
  parsePackageNames,
  resolveArtifactKind,
  summarizeImpact,
} from "./package-inspector-nightly-scan";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("package-inspector-nightly-scan", () => {
  it("preserves author remediation when normalizing inspector issues for upload", () => {
    const findings = normalizeFindings({
      issues: [
        {
          code: "sdk-load-session-store",
          level: "warning",
          severity: "P2",
          issueClass: "deprecated-api",
          message: "loadSessionStore reads the whole session store.",
          authorRemediation: {
            summary: "Replace loadSessionStore with targeted session table APIs.",
            docsUrl: "https://clawhub.ai/docs/plugin-validation-fixes#sdk-load-session-store",
          },
        },
      ],
    });

    expect(findings).toEqual([
      expect.objectContaining({
        code: "sdk-load-session-store",
        authorRemediation: {
          summary: "Replace loadSessionStore with targeted session table APIs.",
          docsUrl: "https://clawhub.ai/docs/plugin-validation-fixes#sdk-load-session-store",
        },
      }),
    ]);
  });

  it("omits malformed remediation and non-author-facing inspector gaps", () => {
    const findings = normalizeFindings({
      issues: [
        {
          code: "sdk-session-store-write",
          message: "writeSessionStore writes the whole session store.",
          authorRemediation: {
            summary: "  ",
            docsUrl: "https://clawhub.ai/docs/plugin-validation-fixes#sdk-session-store-write",
          },
        },
        {
          code: "internal-inspector-gap",
          issueClass: "inspector-gap",
          message: "The inspector needs a follow-up rule.",
          authorRemediation: {
            summary: "This should not be shown to plugin authors.",
          },
        },
      ],
    });

    expect(findings).toEqual([
      expect.objectContaining({
        code: "sdk-session-store-write",
        authorRemediation: undefined,
      }),
    ]);
  });

  it("parses targeted package names from comma or newline separated workflow input", () => {
    expect(
      parsePackageNames(`
        @openclaw/discord, @botcord/botcord
        @openclaw/discord
        watcher-channel
      `),
    ).toEqual(["@openclaw/discord", "@botcord/botcord", "watcher-channel"]);
  });

  it("resolves artifact kind from the worker artifact header for targeted scans", () => {
    expect(
      resolveArtifactKind(
        undefined,
        new Headers({ "X-ClawHub-Artifact-Type": "npm-pack-tarball" }),
      ),
    ).toBe("npm-pack");
    expect(
      resolveArtifactKind(
        undefined,
        new Headers({ "X-ClawHub-Artifact-Type": "legacy-plugin-zip" }),
      ),
    ).toBe("legacy-zip");
    expect(resolveArtifactKind("npm-pack", new Headers())).toBe("npm-pack");
  });

  it("removes only verified POSIX archive metadata before inspecting a legacy plugin", async () => {
    const extractedRoot = await mkdtemp(path.join(tmpdir(), "clawhub-inspector-pax-"));
    temporaryRoots.push(extractedRoot);
    const packageRoot = path.join(extractedRoot, "package");
    await mkdir(path.join(packageRoot, "PaxHeader"), { recursive: true });
    await writeFile(path.join(packageRoot, "package.json"), '{"name":"demo"}\n');
    await writeFile(path.join(packageRoot, "openclaw.plugin.json"), '{"id":"demo"}\n');
    await writeFile(
      path.join(packageRoot, "PaxHeader", "openclaw.plugin.json"),
      "30 mtime=1774419511.917787602\n",
    );
    await writeFile(path.join(packageRoot, "PaxHeader", "payload.js"), "export default 'keep';\n");
    await writeFile(path.join(packageRoot, "PaxHeader", "oversized"), Buffer.alloc(64 * 1024 + 1));

    const scanRoot = await prepareExtractedPluginRoot(extractedRoot, "legacy-zip", "demo");

    expect(scanRoot).toBe(packageRoot);
    await expect(access(path.join(scanRoot, "openclaw.plugin.json"))).resolves.toBeUndefined();
    await expect(
      access(path.join(scanRoot, "PaxHeader", "openclaw.plugin.json")),
    ).rejects.toThrow();
    await expect(access(path.join(scanRoot, "PaxHeader", "payload.js"))).resolves.toBeUndefined();
    await expect(access(path.join(scanRoot, "PaxHeader", "oversized"))).resolves.toBeUndefined();
  });

  it("writes a valid synthetic fixture id for a scoped package with an underscore", async () => {
    const pluginRoot = await mkdtemp(path.join(tmpdir(), "clawhub-inspector-fixture-id-"));
    temporaryRoots.push(pluginRoot);

    await prepareExtractedPluginRoot(pluginRoot, "npm-pack", "@glin_1/miniabc");

    const config = JSON.parse(
      await readFile(path.join(pluginRoot, ".plugin-inspector.json"), "utf8"),
    );
    expect(config.plugin.id).toBe("glin-1-miniabc");
  });

  it.each([
    ["plugin.with_dots_and_underscores", "plugin-with-dots-and-underscores"],
    ["...___", "plugin"],
  ])("normalizes synthetic fixture id %s to %s", async (packageName, expectedId) => {
    const pluginRoot = await mkdtemp(path.join(tmpdir(), "clawhub-inspector-fixture-id-"));
    temporaryRoots.push(pluginRoot);

    await prepareExtractedPluginRoot(pluginRoot, "npm-pack", packageName);

    const config = JSON.parse(
      await readFile(path.join(pluginRoot, ".plugin-inspector.json"), "utf8"),
    );
    expect(config.plugin.id).toBe(expectedId);
  });

  it("reports the exact beta target and unchanged releases in the run summary", () => {
    const summary = summarizeImpact({
      claimed: 2,
      scanned: 1,
      skippedUnchanged: 1,
      batches: 1,
      truncated: false,
      nextCursor: null,
      inspectorVersion: "0.6.0",
      targetOpenClawVersion: "2026.8.0-beta.1",
      entries: [],
    });

    expect(summary).toMatchObject({
      inspectorVersion: "0.6.0",
      targetOpenClawVersion: "2026.8.0-beta.1",
      skippedUnchangedReleases: 1,
    });
    expect(renderImpactMarkdown(summary)).toContain("- Target OpenClaw: 2026.8.0-beta.1");
    expect(renderImpactMarkdown(summary)).toContain("- Skipped unchanged releases: 1");
  });

  it("resolves and prepares the beta target once for reuse across the bulk run", async () => {
    const resolved = { requestedVersion: "beta", version: "2026.8.0-beta.1" };
    const prepared = { ...resolved, status: "ok", cache: { hit: false, key: "beta-key" } };
    const resolveVersion = vi.fn().mockResolvedValue(resolved);
    const prepare = vi.fn().mockResolvedValue(prepared);

    await expect(
      prepareBulkOpenClawTarget("beta", {
        openClawTargets: { resolveVersion, prepare },
      }),
    ).resolves.toEqual({
      exactVersion: "2026.8.0-beta.1",
      target: prepared,
    });
    expect(resolveVersion).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(resolveNightlyOpenClawTarget(undefined)).toBe("beta");
    expect(() => resolveNightlyOpenClawTarget("latest")).toThrow(
      "Nightly plugin scans only support the OpenClaw beta target",
    );
  });

  it("keeps the scan run identity stable across GitHub workflow reruns", () => {
    expect(
      resolveScanRunId({
        GITHUB_RUN_ID: "12345",
        GITHUB_RUN_ATTEMPT: "2",
      }),
    ).toBe("12345");
    expect(
      resolveScanRunId({
        PLUGIN_INSPECTOR_RUN_ID: "manual-run",
        GITHUB_RUN_ID: "12345",
      }),
    ).toBe("manual-run");
  });

  it("acknowledges a processed batch before the runner advances its cursor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, cursor: "page-2", completed: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(acknowledgeBatch("page-2", "run-42")).resolves.toMatchObject({
      ok: true,
      cursor: "page-2",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "/api/v1/package-inspector/acknowledge?runId=run-42&cursor=page-2",
    );
    vi.unstubAllGlobals();
  });
});
