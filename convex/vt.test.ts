/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { __test, pollPackageReleaseScanResults, scanPackageReleaseWithVirusTotal } from "./vt";

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

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

const originalVtApiKey = process.env.VT_API_KEY;

afterEach(() => {
  if (originalVtApiKey === undefined) {
    delete process.env.VT_API_KEY;
  } else {
    process.env.VT_API_KEY = originalVtApiKey;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("vt activation fallback", () => {
  it("activates only VT-pending hidden skills", () => {
    expect(
      __test.shouldActivateWhenVtUnavailable({
        moderationStatus: "hidden",
        moderationReason: "pending.scan",
      }),
    ).toBe(true);

    expect(
      __test.shouldActivateWhenVtUnavailable({
        moderationStatus: "hidden",
        moderationReason: "scanner.vt.pending",
      }),
    ).toBe(true);

    expect(
      __test.shouldActivateWhenVtUnavailable({
        moderationStatus: "hidden",
        moderationReason: "pending.scan.stale",
      }),
    ).toBe(true);
  });

  it("does not activate quality or scanner-hidden skills", () => {
    expect(
      __test.shouldActivateWhenVtUnavailable({
        moderationStatus: "hidden",
        moderationReason: "quality.low",
      }),
    ).toBe(false);

    expect(
      __test.shouldActivateWhenVtUnavailable({
        moderationStatus: "hidden",
        moderationReason: "scanner.llm.malicious",
      }),
    ).toBe(false);
  });

  it("does not activate blocked or already-active skills", () => {
    expect(
      __test.shouldActivateWhenVtUnavailable({
        moderationStatus: "hidden",
        moderationReason: "pending.scan",
        moderationFlags: ["blocked.malware"],
      }),
    ).toBe(false);

    expect(
      __test.shouldActivateWhenVtUnavailable({
        moderationStatus: "active",
        moderationReason: "pending.scan",
      }),
    ).toBe(false);
  });
});

describe("vt AV engine fallback verdicts", () => {
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

  it("keeps undetected-only results pending", () => {
    expect(
      __test.statusFromAvStats({
        malicious: 0,
        suspicious: 0,
        harmless: 0,
        undetected: 40,
      }),
    ).toBeNull();
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

    expect(scheduler.runAfter).toHaveBeenCalledWith(
      5 * 60 * 1000,
      expect.anything(),
      { releaseId: "packageReleases:demo", attempt: 3 },
    );
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
          get: vi.fn(async () => new Blob(['{"name":"demo-plugin"}'], { type: "application/json" })),
        },
      } as never,
      { releaseId: "packageReleases:demo" },
    );

    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        releaseId: "packageReleases:demo",
        sha256hash: expect.any(String),
      }),
    );
    expect(scheduler.runAfter).toHaveBeenCalledWith(
      5 * 60 * 1000,
      expect.anything(),
      { releaseId: "packageReleases:demo", attempt: 2 },
    );
  });

  it("retries package poll when VT lookup throws", async () => {
    process.env.VT_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    const scheduler = { runAfter: vi.fn(async () => null) };
    await pollPackageReleaseScanResultsHandler(
      {
        runQuery: vi.fn().mockResolvedValue({
          _id: "packageReleases:demo",
          packageId: "packages:demo",
          version: "1.0.0",
          sha256hash: "abc123",
        }),
        runMutation: vi.fn(async () => null),
        scheduler,
      } as never,
      { releaseId: "packageReleases:demo", attempt: 3 },
    );

    expect(scheduler.runAfter).toHaveBeenCalledWith(
      5 * 60 * 1000,
      expect.anything(),
      { releaseId: "packageReleases:demo", attempt: 4 },
    );
  });
});
