/* @vitest-environment node */

import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeBatch,
  downloadPackageArtifactForScan,
  loadNotificationManifest,
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
  vi.unstubAllGlobals();
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

  it("reconstructs a historical legacy package after the protected archive exhausts memory", async () => {
    const workRoot = await mkdtemp(path.join(tmpdir(), "clawhub-inspector-large-legacy-"));
    temporaryRoots.push(workRoot);
    const pluginRoot = path.join(workRoot, "plugin");
    await mkdir(pluginRoot, { recursive: true });
    const packageJson = "demo-json\n";
    const payload = "payload";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
      .mockResolvedValueOnce(
        Response.json({
          version: {
            files: [
              {
                path: "package.json",
                size: 10,
                sha256: "2386ce4f9ff896e68d02f8d831311d17f966d6f91bdbf2c8b9085bbf2f84417d",
              },
              {
                path: "output/payload.bin",
                size: 7,
                sha256: "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5",
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(new Response(packageJson))
      .mockResolvedValueOnce(new Response(payload));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      downloadPackageArtifactForScan(
        {
          packageId: "packages:demo",
          releaseId: "packageReleases:demo-1",
          packageName: "@demo/large-plugin",
          version: "1.0.0",
          artifactKind: "legacy-zip",
          downloadUrl:
            "https://clawhub.ai/api/v1/package-inspector/artifact?releaseId=packageReleases%3Ademo-1",
        },
        workRoot,
        pluginRoot,
      ),
    ).resolves.toBe("legacy-zip");

    await expect(readFile(path.join(pluginRoot, "package", "package.json"), "utf8")).resolves.toBe(
      packageJson,
    );
    await expect(
      readFile(path.join(pluginRoot, "package", "output", "payload.bin"), "utf8"),
    ).resolves.toBe(payload);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://clawhub.ai/api/v1/package-inspector/artifact?releaseId=packageReleases%3Ademo-1",
      "https://clawhub.ai/api/v1/packages/%40demo%2Flarge-plugin/versions/1.0.0",
      "https://clawhub.ai/api/v1/packages/%40demo%2Flarge-plugin/file?path=package.json&version=1.0.0",
      "https://clawhub.ai/api/v1/packages/%40demo%2Flarge-plugin/file?path=output%2Fpayload.bin&version=1.0.0",
    ]);
  });

  it("fails closed when a reconstructed legacy file does not match its manifest checksum", async () => {
    const workRoot = await mkdtemp(path.join(tmpdir(), "clawhub-inspector-legacy-checksum-"));
    temporaryRoots.push(workRoot);
    const pluginRoot = path.join(workRoot, "plugin");
    await mkdir(pluginRoot, { recursive: true });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
        .mockResolvedValueOnce(
          Response.json({
            version: {
              files: [{ path: "package.json", size: 7, sha256: "0".repeat(64) }],
            },
          }),
        )
        .mockResolvedValueOnce(new Response("payload")),
    );

    await expect(
      downloadPackageArtifactForScan(
        {
          packageId: "packages:demo",
          releaseId: "packageReleases:demo-1",
          packageName: "demo",
          version: "1.0.0",
          artifactKind: "legacy-zip",
          downloadUrl: "https://clawhub.ai/api/v1/package-inspector/artifact",
        },
        workRoot,
        pluginRoot,
      ),
    ).rejects.toThrow("legacy package file checksum mismatch for package.json");
    await expect(access(path.join(pluginRoot, "package", "package.json"))).rejects.toThrow();
  });

  it.each([
    ["delay seconds", "0"],
    ["HTTP date", new Date(0).toUTCString()],
  ])(
    "retries a transient rate-limit contention response with Retry-After %s",
    async (_label, retryAfter) => {
      const workRoot = await mkdtemp(path.join(tmpdir(), "clawhub-inspector-legacy-retry-"));
      temporaryRoots.push(workRoot);
      const pluginRoot = path.join(workRoot, "plugin");
      await mkdir(pluginRoot, { recursive: true });
      const payload = "payload";
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
        .mockResolvedValueOnce(
          Response.json({
            version: {
              files: [
                {
                  path: "package.json",
                  size: 7,
                  sha256: "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5",
                },
              ],
            },
          }),
        )
        .mockResolvedValueOnce(
          new Response("Rate limit temporarily unavailable", {
            status: 503,
            headers: { "Retry-After": retryAfter },
          }),
        )
        .mockResolvedValueOnce(new Response(payload));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        downloadPackageArtifactForScan(
          {
            packageId: "packages:demo",
            releaseId: "packageReleases:demo-1",
            packageName: "demo",
            version: "1.0.0",
            artifactKind: "legacy-zip",
            downloadUrl: "https://clawhub.ai/api/v1/package-inspector/artifact",
          },
          workRoot,
          pluginRoot,
        ),
      ).resolves.toBe("legacy-zip");
      expect(fetchMock).toHaveBeenCalledTimes(4);
      await expect(
        readFile(path.join(pluginRoot, "package", "package.json"), "utf8"),
      ).resolves.toBe(payload);
    },
  );

  it("fails closed when a reconstructed legacy manifest contains an unsafe path", async () => {
    const workRoot = await mkdtemp(path.join(tmpdir(), "clawhub-inspector-legacy-path-"));
    temporaryRoots.push(workRoot);
    const pluginRoot = path.join(workRoot, "plugin");
    await mkdir(pluginRoot, { recursive: true });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
      .mockResolvedValueOnce(
        Response.json({
          version: {
            files: [{ path: "../outside", size: 7, sha256: "0".repeat(64) }],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      downloadPackageArtifactForScan(
        {
          packageId: "packages:demo",
          releaseId: "packageReleases:demo-1",
          packageName: "demo",
          version: "1.0.0",
          artifactKind: "legacy-zip",
          downloadUrl: "https://clawhub.ai/api/v1/package-inspector/artifact",
        },
        workRoot,
        pluginRoot,
      ),
    ).rejects.toThrow("legacy package contains unsafe file path: ../outside");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(access(path.join(workRoot, "outside"))).rejects.toThrow();
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

  it("accepts a UTF-8 BOM before downloaded plugin manifests", async () => {
    const pluginRoot = await mkdtemp(path.join(tmpdir(), "clawhub-inspector-package-json-"));
    temporaryRoots.push(pluginRoot);
    await writeFile(
      path.join(pluginRoot, "package.json"),
      '\uFEFF{"name":"eu-compliance-skill","version":"1.0.1"}\n',
    );
    await writeFile(
      path.join(pluginRoot, "openclaw.plugin.json"),
      '\uFEFF{"id":"eu-compliance-skill"}\n',
    );
    const nestedPackageRoot = path.join(pluginRoot, "showmethemoney-skill", "demo-backend");
    await mkdir(nestedPackageRoot, { recursive: true });
    await writeFile(
      path.join(nestedPackageRoot, "package.json"),
      '\uFEFF{"name":"stablepay-demo-backend"}\n',
    );

    await expect(
      prepareExtractedPluginRoot(pluginRoot, "npm-pack", "eu-compliance-skill"),
    ).resolves.toBe(pluginRoot);
    const config = JSON.parse(
      await readFile(path.join(pluginRoot, ".plugin-inspector.json"), "utf8"),
    );
    expect(config.plugin.id).toBe("eu-compliance-skill");
    expect(await readFile(path.join(pluginRoot, "package.json"), "utf8")).toBe(
      '{"name":"eu-compliance-skill","version":"1.0.1"}\n',
    );
    expect(await readFile(path.join(pluginRoot, "openclaw.plugin.json"), "utf8")).toBe(
      '{"id":"eu-compliance-skill"}\n',
    );
    expect(await readFile(path.join(nestedPackageRoot, "package.json"), "utf8")).toBe(
      '{"name":"stablepay-demo-backend"}\n',
    );
  });

  it.each([
    ["ordinary invalid JSON", "not json\n"],
    ["a second leading UTF-8 BOM", '\uFEFF\uFEFF{"name":"still-invalid"}\n'],
  ])("rejects %s in a downloaded package.json", async (_description, contents) => {
    const pluginRoot = await mkdtemp(path.join(tmpdir(), "clawhub-inspector-package-json-"));
    temporaryRoots.push(pluginRoot);
    await writeFile(path.join(pluginRoot, "package.json"), contents);

    await expect(
      prepareExtractedPluginRoot(pluginRoot, "npm-pack", "invalid-json-plugin"),
    ).rejects.toThrow(SyntaxError);
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

  it("loads only hard-error releases from an exact completed no-email scan", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "clawhub-inspector-notification-manifest-"));
    temporaryRoots.push(root);
    const manifestPath = path.join(root, "run-summary.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        dryRun: false,
        notificationOnly: false,
        notifyOwners: false,
        truncated: false,
        nextCursor: null,
        inspectorVersion: "0.3.20",
        targetOpenClawVersion: "2026.8.0-beta.1",
        packages: [
          {
            packageId: "packages:error",
            releaseId: "packageReleases:error",
            packageName: "error-plugin",
            version: "1.0.0",
            errorCount: 1,
          },
          {
            packageId: "packages:warning",
            releaseId: "packageReleases:warning",
            packageName: "warning-plugin",
            version: "2.0.0",
            errorCount: 0,
          },
        ],
      }),
    );

    await expect(loadNotificationManifest(manifestPath, "0.3.20")).resolves.toEqual({
      targetOpenClawVersion: "2026.8.0-beta.1",
      items: [
        {
          packageId: "packages:error",
          releaseId: "packageReleases:error",
          packageName: "error-plugin",
          version: "1.0.0",
          downloadUrl: "",
        },
      ],
    });
  });

  it("rejects notification manifests that do not prove a completed no-email scan", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "clawhub-inspector-notification-manifest-"));
    temporaryRoots.push(root);
    const manifestPath = path.join(root, "run-summary.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        dryRun: false,
        notificationOnly: false,
        notifyOwners: true,
        truncated: false,
        nextCursor: null,
        inspectorVersion: "0.3.20",
        targetOpenClawVersion: "2026.8.0-beta.1",
        packages: [],
      }),
    );

    await expect(loadNotificationManifest(manifestPath, "0.3.20")).rejects.toThrow(
      "completed no-email production scan",
    );
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
