/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDeterministicZip } from "./lib/skillZip";
import {
  __test,
  fetchResults,
  pollPendingScans,
  pollPackageReleaseScanResults,
  repairPendingSkillVtAnalysis,
  scanWithVirusTotal,
  scanPackageReleaseWithVirusTotal,
} from "./vt";

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const scanWithVirusTotalHandler = (
  scanWithVirusTotal as unknown as WrappedHandler<{ versionId: string }, void>
)._handler;

const scanPackageReleaseWithVirusTotalHandler = (
  scanPackageReleaseWithVirusTotal as unknown as WrappedHandler<
    { releaseId: string; attempt?: number },
    void
  >
)._handler;

const pollPackageReleaseScanResultsHandler = (
  pollPackageReleaseScanResults as unknown as WrappedHandler<
    { releaseId: string; attempt?: number },
    void
  >
)._handler;

const fetchResultsHandler = (
  fetchResults as unknown as WrappedHandler<
    { sha256hash?: string },
    { status: string; message?: string; url?: string }
  >
)._handler;

const pollPendingScansHandler = (
  pollPendingScans as unknown as WrappedHandler<
    { batchSize?: number },
    { processed: number; updated: number; staled?: number; healthy: boolean; queueSize?: number }
  >
)._handler;

const repairPendingSkillVtAnalysisHandler = (
  repairPendingSkillVtAnalysis as unknown as WrappedHandler<
    { dryRun: boolean; batchSize?: number; cursor?: string | null },
    {
      dryRun: boolean;
      total: number;
      wouldUpdate: number;
      updated: number;
      noResults: number;
      noDecisiveStats: number;
      errors: number;
      done: boolean;
      cursor: string | null;
      statusCounts: Record<string, number>;
      sampleUpdated: Array<{ slug: string; status: string }>;
    }
  >
)._handler;

const originalVtApiKey = process.env.VT_API_KEY;

function mutationPayloads(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls.map((call) => call[1] as Record<string, unknown>);
}

function expectVtAnalysisMutation(
  mock: ReturnType<typeof vi.fn>,
  expected: Record<string, unknown>,
) {
  expect(mutationPayloads(mock)).toContainEqual(
    expect.objectContaining({
      vtAnalysis: expect.objectContaining(expected),
    }),
  );
}

afterEach(() => {
  if (originalVtApiKey === undefined) {
    delete process.env.VT_API_KEY;
  } else {
    process.env.VT_API_KEY = originalVtApiKey;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("vt unavailable fallback", () => {
  it("does not activate a skill when VT is not configured", async () => {
    delete process.env.VT_API_KEY;
    const ctx = {
      runQuery: vi.fn(),
      runMutation: vi.fn(),
    };

    await scanWithVirusTotalHandler(ctx as never, { versionId: "skillVersions:demo" });

    expect(ctx.runQuery).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("marks stale pending scans without activating hidden skills", async () => {
    process.env.VT_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({ status: 404, ok: false });
    vi.stubGlobal("fetch", fetchMock);

    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        queueSize: 1,
        staleCount: 0,
        veryStaleCount: 0,
        oldestAgeMinutes: 5,
        healthy: true,
      })
      .mockResolvedValueOnce([
        {
          skillId: "skills:pending",
          versionId: "skillVersions:pending",
          sha256hash: "a".repeat(64),
          checkCount: 9,
        },
      ]);
    const runMutation = vi.fn(async () => null);

    const result = await pollPendingScansHandler({ runQuery, runMutation } as never, {
      batchSize: 1,
    });

    expect(result).toMatchObject({ processed: 1, updated: 0, staled: 1 });
    expect(runMutation).toHaveBeenCalledTimes(3);
    expect(runMutation).toHaveBeenNthCalledWith(1, expect.anything(), {
      skillId: "skills:pending",
    });
    expect(runMutation).toHaveBeenNthCalledWith(2, expect.anything(), {
      versionId: "skillVersions:pending",
      vtAnalysis: { status: "stale", checkedAt: expect.any(Number) },
    });
    expect(runMutation).toHaveBeenNthCalledWith(3, expect.anything(), {
      versionId: "skillVersions:pending",
      source: "vt-update",
      waitForVtMs: 0,
    });
  });
});

describe("skill VT scans", () => {
  it("hashes and uploads source files without generated Skill Cards", async () => {
    process.env.VT_API_KEY = "test-key";
    const skillBytes = new TextEncoder().encode("# Demo Skill");
    const cardBytes = new TextEncoder().encode("# Generated card");
    const expectedZip = buildDeterministicZip([{ path: "SKILL.md", bytes: skillBytes }], {
      ownerId: "users:owner",
      slug: "demo-skill",
      version: "1.0.0",
      publishedAt: 123,
    });
    const expectedSha = await __test.sha256Hex(expectedZip);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "analysis" } })));
    vi.stubGlobal("fetch", fetchMock);

    const runMutation = vi.fn(async () => null);
    await scanWithVirusTotalHandler(
      {
        runQuery: vi
          .fn()
          .mockResolvedValueOnce({
            _id: "skillVersions:demo",
            skillId: "skills:demo",
            version: "1.0.0",
            createdAt: 123,
            files: [
              { path: "SKILL.md", storageId: "storage:skill" },
              { path: "skill-card.md", storageId: "storage:card" },
            ],
          })
          .mockResolvedValueOnce({
            _id: "skills:demo",
            slug: "demo-skill",
            ownerUserId: "users:owner",
          })
          .mockResolvedValueOnce([{ fingerprint: "bundle-fingerprint", kind: "generated-bundle" }]),
        runMutation,
        storage: {
          get: vi.fn(async (storageId) => {
            if (storageId === "storage:skill") return new Blob([skillBytes]);
            if (storageId === "storage:card") return new Blob([cardBytes]);
            return null;
          }),
        },
      } as never,
      { versionId: "skillVersions:demo" },
    );

    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        versionId: "skillVersions:demo",
        sha256hash: expectedSha,
      }),
    );
    const uploadedFile = (
      fetchMock.mock.calls[1]?.[1] as { body?: FormData } | undefined
    )?.body?.get("file") as File | null;
    expect(uploadedFile?.name).toBe("skill.zip");
    expect(new Uint8Array((await uploadedFile?.arrayBuffer()) ?? [])).toEqual(expectedZip);
  });
});

describe("vt AV engine fallback verdicts", () => {
  it("strips unsupported VT stat keys before caching", () => {
    expect(
      __test.normalizeVtEngineStats({
        "confirmed-timeout": 0,
        failure: 2,
        harmless: 0,
        malicious: 0,
        suspicious: 0,
        timeout: 0,
        "type-unsupported": 10,
        undetected: 64,
      } as never),
    ).toEqual({
      harmless: 0,
      malicious: 0,
      suspicious: 0,
      undetected: 64,
    });
  });

  it("maps engine verdicts in severity order", () => {
    expect(
      __test.statusFromAvStats({
        malicious: 1,
        suspicious: 2,
        harmless: 10,
        undetected: 40,
      }),
    ).toBe("malicious");

    expect(
      __test.statusFromAvStats({
        malicious: 0,
        suspicious: 1,
        harmless: 10,
        undetected: 40,
      }),
    ).toBe("suspicious");

    expect(
      __test.statusFromAvStats({
        malicious: 0,
        suspicious: 0,
        harmless: 1,
        undetected: 40,
      }),
    ).toBe("clean");
  });

  it("treats undetected-only engine results as clean no-detections telemetry", () => {
    expect(
      __test.statusFromAvStats({
        malicious: 0,
        suspicious: 0,
        harmless: 0,
        undetected: 40,
      }),
    ).toBe("clean");
  });
});

describe("vt result lookup", () => {
  it("rejects non-SHA-256 lookup input before calling VirusTotal", async () => {
    process.env.VT_API_KEY = "test-key";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchResultsHandler({} as never, { sha256hash: "../domains/google.com" });

    expect(result).toEqual({ status: "error", message: "Invalid SHA-256 hash" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("looks up only the intended VirusTotal file endpoint for valid hashes", async () => {
    process.env.VT_API_KEY = "test-key";
    const hash = "a".repeat(64);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          attributes: {
            last_analysis_stats: {
              malicious: 0,
              suspicious: 0,
              harmless: 1,
              undetected: 20,
            },
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchResultsHandler({} as never, { sha256hash: hash });

    expect(result.status).toBe("clean");
    expect(fetchMock).toHaveBeenCalledWith(`https://www.virustotal.com/api/v3/files/${hash}`, {
      method: "GET",
      headers: { "x-apikey": "test-key" },
    });
  });

  it("ignores VirusTotal Code Insight results and reports engine stats only", async () => {
    process.env.VT_API_KEY = "test-key";
    const hash = "b".repeat(64);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          attributes: {
            crowdsourced_ai_results: [
              {
                category: "code_insight",
                verdict: "malicious",
                analysis: "AI-only claim that should be ignored.",
                source: "palm",
              },
            ],
            last_analysis_stats: {
              malicious: 0,
              suspicious: 0,
              harmless: 2,
              undetected: 20,
            },
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchResultsHandler({} as never, { sha256hash: hash });

    expect(result).toMatchObject({
      status: "clean",
      source: "engines",
      metadata: {
        stats: {
          malicious: 0,
          suspicious: 0,
          harmless: 2,
          undetected: 20,
        },
      },
    });
    expect((result as { metadata?: Record<string, unknown> }).metadata).not.toHaveProperty(
      "aiVerdict",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("package VT retries", () => {
  it("retries package scan when release files are not readable yet", async () => {
    process.env.VT_API_KEY = "test-key";
    const scheduler = { runAfter: vi.fn(async () => null) };

    await scanPackageReleaseWithVirusTotalHandler(
      {
        runQuery: vi
          .fn()
          .mockResolvedValueOnce({
            _id: "packageReleases:demo",
            packageId: "packages:demo",
            version: "1.0.0",
            files: [{ path: "package.json", storageId: "storage:pkg" }],
          })
          .mockResolvedValueOnce({
            _id: "packages:demo",
            name: "demo-plugin",
          }),
        runMutation: vi.fn(async () => null),
        scheduler,
        storage: {
          get: vi.fn(async () => null),
        },
      } as never,
      { releaseId: "packageReleases:demo", attempt: 2 },
    );

    expect(scheduler.runAfter).toHaveBeenCalledWith(5 * 60 * 1000, expect.anything(), {
      releaseId: "packageReleases:demo",
      attempt: 3,
    });
  });

  it("retries package upload when VT upload fails", async () => {
    process.env.VT_API_KEY = "test-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const runMutation = vi.fn(async () => null);
    const scheduler = { runAfter: vi.fn(async () => null) };
    await scanPackageReleaseWithVirusTotalHandler(
      {
        runQuery: vi
          .fn()
          .mockResolvedValueOnce({
            _id: "packageReleases:demo",
            packageId: "packages:demo",
            version: "1.0.0",
            files: [{ path: "package.json", storageId: "storage:pkg" }],
          })
          .mockResolvedValueOnce({
            _id: "packages:demo",
            name: "demo-plugin",
          }),
        runMutation,
        scheduler,
        storage: {
          get: vi.fn(
            async () => new Blob(['{"name":"demo-plugin"}'], { type: "application/json" }),
          ),
        },
      } as never,
      { releaseId: "packageReleases:demo" },
    );

    expect(mutationPayloads(runMutation).every((payload) => !("sha256hash" in payload))).toBe(true);
    expect(scheduler.runAfter).toHaveBeenCalledWith(5 * 60 * 1000, expect.anything(), {
      releaseId: "packageReleases:demo",
      attempt: 2,
    });
  });

  it("uploads the exact ClawPack tarball for package scans", async () => {
    process.env.VT_API_KEY = "test-key";
    const clawpackBytes = new TextEncoder().encode("exact clawpack tgz bytes");
    const clawpackSha256 = await __test.sha256Hex(clawpackBytes);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: "analysis-clawpack" } }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const runMutation = vi.fn(async () => null);
    const scheduler = { runAfter: vi.fn(async () => null) };
    await scanPackageReleaseWithVirusTotalHandler(
      {
        runQuery: vi
          .fn()
          .mockResolvedValueOnce({
            _id: "packageReleases:demo",
            packageId: "packages:demo",
            version: "1.2.3",
            artifactKind: "npm-pack",
            clawpackStorageId: "storage:clawpack",
            npmTarballName: "demo-plugin-1.2.3.tgz",
            files: [
              { path: "package.json", storageId: "storage:pkg" },
              { path: "openclaw.plugin.json", storageId: "storage:plugin" },
            ],
          })
          .mockResolvedValueOnce({
            _id: "packages:demo",
            name: "demo-plugin",
            family: "code-plugin",
            isOfficial: true,
          }),
        runMutation,
        scheduler,
        storage: {
          get: vi.fn(async (storageId) => {
            if (storageId === "storage:clawpack") {
              return new Blob([clawpackBytes], { type: "application/gzip" });
            }
            return null;
          }),
        },
      } as never,
      { releaseId: "packageReleases:demo" },
    );

    expect(mutationPayloads(runMutation).every((payload) => !("sha256hash" in payload))).toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `https://www.virustotal.com/api/v3/files/${clawpackSha256}`,
      expect.objectContaining({ method: "GET" }),
    );
    const uploadOptions = fetchMock.mock.calls[1]?.[1] as { body?: FormData } | undefined;
    const uploadedFile = uploadOptions?.body?.get("file") as File | null;
    expect(uploadedFile?.name).toBe("demo-plugin-1.2.3.tgz");
    expect(await uploadedFile?.text()).toBe("exact clawpack tgz bytes");
    expect(scheduler.runAfter).toHaveBeenCalledWith(5 * 60 * 1000, expect.anything(), {
      releaseId: "packageReleases:demo",
      attempt: 1,
    });
  });

  it("uses VirusTotal large-file upload URLs above the direct upload limit", async () => {
    process.env.VT_API_KEY = "test-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: "https://upload.example.test/vt" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: "analysis-large" } }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await __test.uploadFileToVirusTotal(
      "test-key",
      new Uint8Array(__test.VIRUSTOTAL_DIRECT_UPLOAD_LIMIT_BYTES + 1),
      "large.tgz",
      "application/gzip",
    );

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://www.virustotal.com/api/v3/files/upload_url",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://upload.example.test/vt",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uses existing AV engine verdicts for packages without re-uploading", async () => {
    process.env.VT_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          attributes: {
            last_analysis_stats: {
              malicious: 0,
              suspicious: 1,
              harmless: 10,
              undetected: 40,
            },
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const runMutation = vi.fn(async () => null);
    const scheduler = { runAfter: vi.fn(async () => null) };
    await scanPackageReleaseWithVirusTotalHandler(
      {
        runQuery: vi
          .fn()
          .mockResolvedValueOnce({
            _id: "packageReleases:demo",
            packageId: "packages:demo",
            version: "1.0.0",
            verification: { tier: "source-linked" },
            llmAnalysis: { status: "clean" },
            staticScan: { status: "clean" },
            files: [{ path: "package.json", storageId: "storage:pkg" }],
          })
          .mockResolvedValueOnce({
            _id: "packages:demo",
            name: "demo-plugin",
            family: "code-plugin",
            isOfficial: true,
          }),
        runMutation,
        scheduler,
        storage: {
          get: vi.fn(
            async () => new Blob(['{"name":"demo-plugin"}'], { type: "application/json" }),
          ),
        },
      } as never,
      { releaseId: "packageReleases:demo" },
    );

    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        releaseId: "packageReleases:demo",
        vtAnalysis: expect.objectContaining({ status: "suspicious", source: "engines" }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("stores undetected-only package VT telemetry even when static scans are suspicious", async () => {
    process.env.VT_API_KEY = "test-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            attributes: {
              last_analysis_stats: {
                malicious: 0,
                suspicious: 0,
                harmless: 0,
                undetected: 66,
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "analysis-123" } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const runMutation = vi.fn(async () => null);
    const scheduler = { runAfter: vi.fn(async () => null) };
    await scanPackageReleaseWithVirusTotalHandler(
      {
        runQuery: vi
          .fn()
          .mockResolvedValueOnce({
            _id: "packageReleases:demo",
            packageId: "packages:demo",
            version: "1.0.0",
            verification: { tier: "source-linked" },
            llmAnalysis: { status: "clean" },
            staticScan: { status: "suspicious" },
            files: [{ path: "package.json", storageId: "storage:pkg" }],
          })
          .mockResolvedValueOnce({
            _id: "packages:demo",
            name: "demo-plugin",
            family: "code-plugin",
            isOfficial: true,
          }),
        runMutation,
        scheduler,
        storage: {
          get: vi.fn(
            async () => new Blob(['{"name":"demo-plugin"}'], { type: "application/json" }),
          ),
        },
      } as never,
      { releaseId: "packageReleases:demo" },
    );

    expectVtAnalysisMutation(runMutation, {
      status: "clean",
      source: "engines",
      engineStats: expect.objectContaining({ undetected: 66 }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("stores undetected-only official package VT telemetry as clean engine results", async () => {
    process.env.VT_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          attributes: {
            last_analysis_stats: {
              malicious: 0,
              suspicious: 0,
              harmless: 0,
              undetected: 66,
            },
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const runMutation = vi.fn(async () => null);
    const scheduler = { runAfter: vi.fn(async () => null) };
    await scanPackageReleaseWithVirusTotalHandler(
      {
        runQuery: vi
          .fn()
          .mockResolvedValueOnce({
            _id: "packageReleases:demo",
            packageId: "packages:demo",
            version: "1.0.0",
            verification: { tier: "source-linked" },
            llmAnalysis: { status: "clean" },
            staticScan: { status: "clean" },
            files: [{ path: "package.json", storageId: "storage:pkg" }],
          })
          .mockResolvedValueOnce({
            _id: "packages:demo",
            name: "demo-plugin",
            family: "code-plugin",
            isOfficial: true,
          }),
        runMutation,
        scheduler,
        storage: {
          get: vi.fn(
            async () => new Blob(['{"name":"demo-plugin"}'], { type: "application/json" }),
          ),
        },
      } as never,
      { releaseId: "packageReleases:demo" },
    );

    expectVtAnalysisMutation(runMutation, {
      status: "clean",
      source: "engines",
      engineStats: expect.objectContaining({ undetected: 66 }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("stores undetected-only community package VT telemetry as clean engine results", async () => {
    process.env.VT_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          attributes: {
            last_analysis_stats: {
              malicious: 0,
              suspicious: 0,
              harmless: 0,
              undetected: 66,
            },
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const runMutation = vi.fn(async () => null);
    const scheduler = { runAfter: vi.fn(async () => null) };
    await scanPackageReleaseWithVirusTotalHandler(
      {
        runQuery: vi
          .fn()
          .mockResolvedValueOnce({
            _id: "packageReleases:demo",
            packageId: "packages:demo",
            version: "1.0.0",
            verification: { tier: "source-linked" },
            llmAnalysis: { status: "clean" },
            staticScan: { status: "clean" },
            files: [{ path: "package.json", storageId: "storage:pkg" }],
          })
          .mockResolvedValueOnce({
            _id: "packages:demo",
            name: "demo-plugin",
            family: "code-plugin",
            isOfficial: false,
          }),
        runMutation,
        scheduler,
        storage: {
          get: vi.fn(
            async () => new Blob(['{"name":"demo-plugin"}'], { type: "application/json" }),
          ),
        },
      } as never,
      { releaseId: "packageReleases:demo" },
    );

    expectVtAnalysisMutation(runMutation, {
      status: "clean",
      source: "engines",
      engineStats: expect.objectContaining({ undetected: 66 }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("retries package poll when VT lookup throws", async () => {
    process.env.VT_API_KEY = "test-key";
    const fetchMock = vi.fn().mockRejectedValue(new Error("network error"));
    vi.stubGlobal("fetch", fetchMock);

    const scheduler = { runAfter: vi.fn(async () => null) };
    await pollPackageReleaseScanResultsHandler(
      {
        runQuery: vi.fn().mockResolvedValue({
          _id: "packageReleases:demo",
          packageId: "packages:demo",
          version: "1.0.0",
          artifactKind: "npm-pack",
          sha256hash: "legacy-zip-sha",
          clawpackSha256: "tgz-sha",
        }),
        runMutation: vi.fn(async () => null),
        scheduler,
      } as never,
      { releaseId: "packageReleases:demo", attempt: 3 },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.virustotal.com/api/v3/files/tgz-sha",
      expect.objectContaining({ method: "GET" }),
    );
    expect(scheduler.runAfter).toHaveBeenCalledWith(5 * 60 * 1000, expect.anything(), {
      releaseId: "packageReleases:demo",
      attempt: 4,
    });
  });

  it("does not poll a legacy ZIP hash when an npm-pack artifact hash is missing", async () => {
    process.env.VT_API_KEY = "test-key";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await pollPackageReleaseScanResultsHandler(
      {
        runQuery: vi.fn().mockResolvedValue({
          _id: "packageReleases:demo",
          packageId: "packages:demo",
          version: "1.0.0",
          artifactKind: "npm-pack",
          sha256hash: "legacy-zip-sha",
        }),
        runMutation: vi.fn(async () => null),
        scheduler: { runAfter: vi.fn(async () => null) },
      } as never,
      { releaseId: "packageReleases:demo", attempt: 3 },
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stores undetected-only package VT telemetry during polling even when static scan is suspicious", async () => {
    process.env.VT_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            attributes: {
              last_analysis_stats: {
                malicious: 0,
                suspicious: 0,
                harmless: 0,
                undetected: 66,
              },
            },
          },
        }),
      }),
    );

    const runMutation = vi.fn(async () => null);
    const scheduler = { runAfter: vi.fn(async () => null) };
    await pollPackageReleaseScanResultsHandler(
      {
        runQuery: vi
          .fn()
          .mockResolvedValueOnce({
            _id: "packageReleases:demo",
            packageId: "packages:demo",
            version: "1.0.0",
            sha256hash: "abc123",
            verification: { tier: "source-linked" },
            llmAnalysis: { status: "clean" },
            staticScan: { status: "suspicious" },
          })
          .mockResolvedValueOnce({
            _id: "packages:demo",
            family: "code-plugin",
            isOfficial: true,
          }),
        runMutation,
        scheduler,
      } as never,
      { releaseId: "packageReleases:demo", attempt: 3 },
    );

    expectVtAnalysisMutation(runMutation, {
      status: "clean",
      source: "engines",
      engineStats: expect.objectContaining({ undetected: 66 }),
    });
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("stores undetected-only community package VT telemetry during polling", async () => {
    process.env.VT_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            attributes: {
              last_analysis_stats: {
                malicious: 0,
                suspicious: 0,
                harmless: 0,
                undetected: 66,
              },
            },
          },
        }),
      }),
    );

    const runMutation = vi.fn(async () => null);
    const scheduler = { runAfter: vi.fn(async () => null) };
    await pollPackageReleaseScanResultsHandler(
      {
        runQuery: vi
          .fn()
          .mockResolvedValueOnce({
            _id: "packageReleases:demo",
            packageId: "packages:demo",
            version: "1.0.0",
            sha256hash: "abc123",
            verification: { tier: "source-linked" },
            llmAnalysis: { status: "clean" },
            staticScan: { status: "clean" },
          })
          .mockResolvedValueOnce({
            _id: "packages:demo",
            family: "code-plugin",
            isOfficial: false,
          }),
        runMutation,
        scheduler,
      } as never,
      { releaseId: "packageReleases:demo", attempt: 3 },
    );

    expectVtAnalysisMutation(runMutation, {
      status: "clean",
      source: "engines",
      engineStats: expect.objectContaining({ undetected: 66 }),
    });
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("stores undetected-only package VT telemetry without requiring trusted verification", async () => {
    process.env.VT_API_KEY = "test-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            attributes: {
              last_analysis_stats: {
                malicious: 0,
                suspicious: 0,
                harmless: 0,
                undetected: 66,
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });
    vi.stubGlobal("fetch", fetchMock);

    const runMutation = vi.fn(async () => null);
    const scheduler = { runAfter: vi.fn(async () => null) };
    await pollPackageReleaseScanResultsHandler(
      {
        runQuery: vi
          .fn()
          .mockResolvedValueOnce({
            _id: "packageReleases:demo",
            packageId: "packages:demo",
            version: "1.0.0",
            sha256hash: "abc123",
            verification: { tier: "artifact-only" },
            llmAnalysis: { status: "clean" },
            staticScan: { status: "clean" },
          })
          .mockResolvedValueOnce({
            _id: "packages:demo",
            family: "code-plugin",
            isOfficial: false,
          }),
        runMutation,
        scheduler,
      } as never,
      { releaseId: "packageReleases:demo", attempt: 3 },
    );

    expectVtAnalysisMutation(runMutation, {
      status: "clean",
      source: "engines",
      engineStats: expect.objectContaining({ undetected: 66 }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });
});

describe("vt pending polling", () => {
  it("does not request VirusTotal reanalysis to trigger Code Insight", async () => {
    process.env.VT_API_KEY = "test-key";
    const hash = "c".repeat(64);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          attributes: {
            last_analysis_stats: {
              malicious: 0,
              suspicious: 0,
              harmless: 0,
              undetected: 66,
            },
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        queueSize: 1,
        staleCount: 0,
        veryStaleCount: 0,
        oldestAgeMinutes: 5,
        healthy: true,
      })
      .mockResolvedValueOnce([
        {
          skillId: "skills:pending",
          versionId: "skillVersions:pending",
          sha256hash: hash,
          checkCount: 9,
        },
      ]);
    const runMutation = vi.fn(async () => null);

    const result = await pollPendingScansHandler({ runQuery, runMutation } as never, {
      batchSize: 1,
    });

    expect(result).toMatchObject({ processed: 1, updated: 1, staled: 0 });
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        versionId: "skillVersions:pending",
        vtAnalysis: expect.objectContaining({
          status: "clean",
          source: "engines",
          engineStats: expect.objectContaining({ undetected: 66 }),
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`https://www.virustotal.com/api/v3/files/${hash}`, {
      method: "GET",
      headers: { "x-apikey": "test-key" },
    });
  });
});

describe("vt pending repair", () => {
  it("dry-runs completed undetected-only pending skills without writing", async () => {
    process.env.VT_API_KEY = "test-key";
    const hash = "d".repeat(64);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            attributes: {
              last_analysis_stats: {
                malicious: 0,
                suspicious: 0,
                harmless: 0,
                undetected: 66,
              },
            },
          },
        }),
      }),
    );

    const runMutation = vi.fn(async () => null);
    const result = await repairPendingSkillVtAnalysisHandler(
      {
        runQuery: vi.fn().mockResolvedValue({
          skills: [
            {
              skillId: "skills:pending",
              versionId: "skillVersions:pending",
              slug: "pending-skill",
              sha256hash: hash,
            },
          ],
          cursor: "next-page",
          done: false,
        }),
        runMutation,
      } as never,
      { dryRun: true, batchSize: 1, cursor: "start-page" },
    );

    expect(result).toMatchObject({
      dryRun: true,
      total: 1,
      wouldUpdate: 1,
      updated: 0,
      done: false,
      cursor: "next-page",
      statusCounts: { clean: 1 },
      sampleUpdated: [{ slug: "pending-skill", status: "clean" }],
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("repairs completed undetected-only pending skills and recomputes moderation", async () => {
    process.env.VT_API_KEY = "test-key";
    const hash = "e".repeat(64);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            attributes: {
              last_analysis_stats: {
                malicious: 0,
                suspicious: 0,
                harmless: 0,
                undetected: 66,
              },
            },
          },
        }),
      }),
    );

    const runMutation = vi.fn(async () => null);
    const result = await repairPendingSkillVtAnalysisHandler(
      {
        runQuery: vi.fn().mockResolvedValue({
          skills: [
            {
              skillId: "skills:pending",
              versionId: "skillVersions:pending",
              slug: "pending-skill",
              sha256hash: hash,
            },
          ],
          cursor: null,
          done: true,
        }),
        runMutation,
      } as never,
      { dryRun: false, batchSize: 1 },
    );

    expect(result).toMatchObject({
      dryRun: false,
      total: 1,
      wouldUpdate: 1,
      updated: 1,
      done: true,
      cursor: null,
      statusCounts: { clean: 1 },
    });
    expect(mutationPayloads(runMutation)).toContainEqual(
      expect.objectContaining({
        versionId: "skillVersions:pending",
        sha256hash: hash,
        vtAnalysis: expect.objectContaining({
          status: "clean",
          source: "engines",
          engineStats: expect.objectContaining({ undetected: 66 }),
        }),
      }),
    );
    expect(mutationPayloads(runMutation)).toContainEqual(
      expect.objectContaining({ skillId: "skills:pending" }),
    );
    expect(mutationPayloads(runMutation)).not.toContainEqual(
      expect.objectContaining({ source: "vt-update" }),
    );
  });

  it("queues ClawScan follow-up when repaired VT telemetry is suspicious", async () => {
    process.env.VT_API_KEY = "test-key";
    const hash = "f".repeat(64);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            attributes: {
              last_analysis_stats: {
                malicious: 0,
                suspicious: 1,
                harmless: 0,
                undetected: 65,
              },
            },
          },
        }),
      }),
    );

    const runMutation = vi.fn(async () => null);
    const result = await repairPendingSkillVtAnalysisHandler(
      {
        runQuery: vi.fn().mockResolvedValue({
          skills: [
            {
              skillId: "skills:pending",
              versionId: "skillVersions:pending",
              slug: "pending-skill",
              sha256hash: hash,
            },
          ],
          cursor: null,
          done: true,
        }),
        runMutation,
      } as never,
      { dryRun: false, batchSize: 100 },
    );

    expect(result).toMatchObject({
      wouldUpdate: 1,
      updated: 1,
      statusCounts: { suspicious: 1 },
    });
    expect(mutationPayloads(runMutation)).toContainEqual(
      expect.objectContaining({
        versionId: "skillVersions:pending",
        source: "vt-update",
        waitForVtMs: 0,
      }),
    );
    expect(mutationPayloads(runMutation)).not.toContainEqual(
      expect.objectContaining({ skillId: "skills:pending" }),
    );
  });

  it("repairs historical pending VT cache rows without recomputing latest moderation", async () => {
    process.env.VT_API_KEY = "test-key";
    const hash = "a".repeat(64);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            attributes: {
              last_analysis_stats: {
                malicious: 0,
                suspicious: 0,
                harmless: 2,
                undetected: 64,
              },
            },
          },
        }),
      }),
    );

    const runMutation = vi.fn(async () => null);
    const result = await repairPendingSkillVtAnalysisHandler(
      {
        runQuery: vi.fn().mockResolvedValue({
          skills: [
            {
              skillId: "skills:pending",
              versionId: "skillVersions:historical",
              slug: "pending-skill",
              sha256hash: hash,
              isLatest: false,
            },
          ],
          cursor: null,
          done: true,
        }),
        runMutation,
      } as never,
      { dryRun: false, batchSize: 100 },
    );

    expect(result).toMatchObject({
      wouldUpdate: 1,
      updated: 1,
      statusCounts: { clean: 1 },
    });
    expect(mutationPayloads(runMutation)).toContainEqual(
      expect.objectContaining({
        versionId: "skillVersions:historical",
        sha256hash: hash,
        vtAnalysis: expect.objectContaining({ status: "clean" }),
      }),
    );
    expect(mutationPayloads(runMutation)).not.toContainEqual(
      expect.objectContaining({ skillId: "skills:pending" }),
    );
    expect(mutationPayloads(runMutation)).not.toContainEqual(
      expect.objectContaining({ source: "vt-update" }),
    );
  });

  it("does not enqueue ClawScan follow-up for suspicious historical VT cache rows", async () => {
    process.env.VT_API_KEY = "test-key";
    const hash = "b".repeat(64);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            attributes: {
              last_analysis_stats: {
                malicious: 0,
                suspicious: 1,
                harmless: 1,
                undetected: 64,
              },
            },
          },
        }),
      }),
    );

    const runMutation = vi.fn(async () => null);
    const result = await repairPendingSkillVtAnalysisHandler(
      {
        runQuery: vi.fn().mockResolvedValue({
          skills: [
            {
              skillId: "skills:pending",
              versionId: "skillVersions:historical",
              slug: "pending-skill",
              sha256hash: hash,
              isLatest: false,
            },
          ],
          cursor: null,
          done: true,
        }),
        runMutation,
      } as never,
      { dryRun: false, batchSize: 100 },
    );

    expect(result).toMatchObject({
      wouldUpdate: 1,
      updated: 1,
      statusCounts: { suspicious: 1 },
    });
    expect(mutationPayloads(runMutation)).toContainEqual(
      expect.objectContaining({
        versionId: "skillVersions:historical",
        sha256hash: hash,
        vtAnalysis: expect.objectContaining({ status: "suspicious" }),
      }),
    );
    expect(mutationPayloads(runMutation)).not.toContainEqual(
      expect.objectContaining({ source: "vt-update" }),
    );
  });

  it("returns pagination cursor when unresolved pending VT rows are skipped", async () => {
    process.env.VT_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }),
    );

    const runMutation = vi.fn(async () => null);
    const result = await repairPendingSkillVtAnalysisHandler(
      {
        runQuery: vi.fn().mockResolvedValue({
          skills: [
            {
              skillId: "skills:pending",
              versionId: "skillVersions:pending",
              slug: "pending-skill",
              sha256hash: "a".repeat(64),
            },
          ],
          cursor: "next-page",
          done: false,
        }),
        runMutation,
      } as never,
      { dryRun: true, batchSize: 1 },
    );

    expect(result).toMatchObject({
      total: 1,
      wouldUpdate: 0,
      noResults: 1,
      done: false,
      cursor: "next-page",
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("reports done only when no pending VT skills are selected", async () => {
    process.env.VT_API_KEY = "test-key";

    const result = await repairPendingSkillVtAnalysisHandler(
      {
        runQuery: vi.fn().mockResolvedValue({ skills: [], cursor: null, done: true }),
        runMutation: vi.fn(async () => null),
      } as never,
      { dryRun: true, batchSize: 100 },
    );

    expect(result).toMatchObject({
      total: 0,
      wouldUpdate: 0,
      done: true,
    });
  });
});
