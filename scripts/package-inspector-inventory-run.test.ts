/* @vitest-environment node */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";

const inspector = vi.hoisted(() => ({ runCheck: vi.fn() }));
// The separately versioned Inspector is the external producer at this boundary.
// Detector accuracy is proven by its independent source benchmark, not this fixture.
vi.mock("@openclaw/plugin-inspector", () => ({
  openClawTargets: {
    resolveVersion: async () => ({ version: "2026.10.14-beta.1" }),
    prepare: async () => ({ version: "2026.10.14-beta.1" }),
  },
  pluginRoot: { runCheck: inspector.runCheck },
  ci: { writeOutputs: async () => {} },
  reports: { sanitizeArtifact: (report: unknown) => report },
}));
let root: string;
const originalExitCode = process.exitCode;
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  process.exitCode = originalExitCode;
  if (root) await rm(root, { recursive: true, force: true });
});

it.each([false, true])(
  "preserves author findings and reconciles a silent run (legacy report: %s)",
  async (legacyReport) => {
    root = await mkdtemp(path.join(tmpdir(), "clawhub-inventory-run-"));
    vi.stubEnv("CLAWHUB_SITE_URL", "https://fixture.invalid");
    vi.stubEnv("CLAWHUB_PLUGIN_INSPECTOR_WORKER_TOKEN", "fixture-only-token");
    vi.stubEnv("PLUGIN_INSPECTOR_ARTIFACT_DIR", root);
    vi.stubEnv("PLUGIN_INSPECTOR_VERSION", "fixture-inspector");
    vi.stubEnv("PLUGIN_INSPECTOR_NOTIFY_OWNERS", "false");
    vi.stubEnv("PLUGIN_INSPECTOR_NOTIFICATION_ONLY", "false");
    vi.stubEnv("PLUGIN_INSPECTOR_DRY_RUN", "false");
    vi.stubEnv("PLUGIN_INSPECTOR_PACKAGE_NAMES", "");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const report = {
      targetOpenClaw: { version: "2026.10.14-beta.1" },
      issues: [
        { code: "sdk-hard-error", level: "error", message: "Preserve the existing author finding" },
      ],
      sdkUsage: {
        schemaVersion: 1,
        analysisVersion: "1",
        inputKind: "artifact",
        status: "complete",
        entries: [],
        unknowns: [],
        coverage: { filesDiscovered: 1, filesAnalyzed: 1, filesExcluded: 0 },
      },
    };
    const producerReport = legacyReport ? { ...report, sdkUsage: undefined } : report;
    inspector.runCheck.mockImplementationOnce(async ({ outDir }: { outDir: string }) => ({
      report: producerReport,
      paths: { jsonPath: path.join(outDir, "report.json") },
    }));
    inspector.runCheck.mockRejectedValueOnce(new Error("Unreadable plugin source"));
    const artifactSha256 = "a".repeat(64);
    const items = ["clean", "failed"].map((name) => ({
      packageId: `package-${name}`,
      releaseId: `release-${name}`,
      packageName: name,
      version: "1.0.0",
      artifactKind: "legacy-zip",
      artifactSha256,
      downloadUrl: `https://fixture.invalid/artifact/${name}`,
    }));
    const skipped = {
      packageName: "unchanged",
      version: "1.0.0",
      releaseId: "release-unchanged",
      reason: "compatible-complete-inventory",
    };
    const uploads: Array<Record<string, unknown>> = [];
    const acknowledgements: Array<string | null> = [];
    let claims = 0;
    let rosterReads = 0;
    vi.stubGlobal("fetch", async (input: string | URL, options?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname === "/api/v1/sdk-usage/coverage") {
        rosterReads += 1;
        return Response.json({
          scope: "page",
          nextCursor: null,
          items: [
            ...items.map((item) => ({
              packageName: item.packageName,
              releaseId: item.releaseId,
              version: item.version,
              status: uploads.length
                ? item.packageName === "failed" || legacyReport
                  ? "failed"
                  : "complete"
                : "missing",
              unknownCount: 0,
            })),
            { ...skipped, status: "complete", unknownCount: 0 },
          ],
        });
      }
      if (url.pathname.endsWith("/claim")) {
        expect(url.searchParams.get("notifyOwners")).toBe("false");
        expect(url.searchParams.get("inventorySchemaVersion")).toBe("1");
        claims += 1;
        return Response.json({
          ok: true,
          leased: false,
          items: claims === 1 ? [] : items,
          nextCursor: claims === 1 ? "second-page" : null,
          skippedUnchanged: claims === 1 ? 1 : 0,
          skipped: claims === 1 ? [skipped] : [],
        });
      }
      if (url.pathname.startsWith("/artifact/")) {
        return new Response(
          zipSync({
            "package.json": strToU8('{"name":"fixture"}'),
            "openclaw.plugin.json": strToU8('{"id":"fixture"}'),
          }),
          { headers: { "X-ClawHub-Artifact-Sha256": artifactSha256 } },
        );
      }
      if (url.pathname.endsWith("/results")) {
        const body = JSON.parse(String(options?.body));
        uploads.push(body);
        return Response.json({
          ok: true,
          inserted: body.findings.length,
          shouldEmailOwner: true,
          sdkUsage: {
            status: body.sdkUsage.status,
            applied: true,
            entryCount: 0,
            unknownCount: body.sdkUsage.unknowns.length,
          },
        });
      }
      if (url.pathname.endsWith("/acknowledge")) {
        acknowledgements.push(url.searchParams.get("cursor"));
        return Response.json({ ok: true });
      }
      throw new Error(`Unexpected outbound request: ${url.pathname}`);
    });
    vi.resetModules();
    const { runPackageInspectorNightlyScan } = await import("./package-inspector-nightly-scan");
    await runPackageInspectorNightlyScan();
    const summary = JSON.parse(await readFile(path.join(root, "run-summary.json"), "utf8"));
    expect(uploads).toHaveLength(2);
    expect(uploads.every((body) => body.notifyOwners === false)).toBe(true);
    expect(uploads[0].findings).toMatchObject([{ code: "sdk-hard-error" }]);
    expect(uploads[0].inspectionFailed).toBeUndefined();
    if (legacyReport) {
      expect(uploads[0].sdkUsage).toMatchObject({ status: "failed" });
    } else {
      expect(uploads[0].sdkUsage).toEqual(report.sdkUsage);
    }
    expect(uploads[1]).toMatchObject({ inspectionFailed: true, sdkUsage: { status: "failed" } });
    expect(acknowledgements).toEqual(["second-page", null]);
    expect(summary).toMatchObject({
      notificationAttempts: 0,
      notificationsSent: 0,
      inventoryCompleteReleases: legacyReport ? 0 : 1,
      inventoryIncompleteReleases: legacyReport ? 2 : 1,
      skipped: [skipped],
    });
    expect(summary.corpus.initial).toHaveLength(3);
    expect(summary.corpus.reconciled).toHaveLength(3);
    expect(summary.corpus.unresolved).toHaveLength(legacyReport ? 2 : 1);
    expect(summary.corpus.unresolved).toContainEqual(
      expect.objectContaining({ packageName: "failed", status: "failed" }),
    );
    expect(rosterReads).toBe(2);
    expect(process.exitCode).toBe(1);
  },
);
