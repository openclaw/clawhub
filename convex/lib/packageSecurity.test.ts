import { describe, expect, it } from "vitest";
import {
  getPackageDownloadSecurityBlock,
  getPackageTrustReasons,
  isPackageBlockedFromPublic,
  resolvePackageReleaseScanStatus,
} from "./packageSecurity";

describe("packageSecurity", () => {
  it("treats pending package scans as public", () => {
    expect(isPackageBlockedFromPublic("pending")).toBe(false);
  });

  it("allows package downloads while VT is pending", () => {
    expect(
      getPackageDownloadSecurityBlock({
        sha256hash: "a".repeat(64),
      } as never),
    ).toBeNull();
  });

  it("still resolves sha256-only releases to pending", () => {
    expect(
      resolvePackageReleaseScanStatus({
        sha256hash: "a".repeat(64),
      } as never),
    ).toBe("pending");
  });

  it("still blocks engine-backed malicious package releases", () => {
    expect(isPackageBlockedFromPublic("malicious")).toBe(true);
    expect(
      getPackageDownloadSecurityBlock({
        vtAnalysis: {
          status: "malicious",
          source: "engines",
          engineStats: { malicious: 1, suspicious: 0, harmless: 12, undetected: 54 },
        },
      } as never),
    ).toEqual(
      expect.objectContaining({
        status: 403,
      }),
    );
  });

  it("keeps AI-only VT suspicious advisory when engines are clean", () => {
    const release = {
      sha256hash: "a".repeat(64),
      vtAnalysis: {
        status: "suspicious",
        scanner: "code_insight",
        source: "palm",
        engineStats: { malicious: 0, suspicious: 0, harmless: 12, undetected: 54 },
      },
    } as never;

    expect(resolvePackageReleaseScanStatus(release)).toBe("pending");
    expect(getPackageDownloadSecurityBlock(release)).toBeNull();
  });

  it("keeps AI-only VT malicious advisory when engines are clean", () => {
    const release = {
      sha256hash: "a".repeat(64),
      vtAnalysis: {
        status: "malicious",
        scanner: "code_insight",
        source: "palm",
        engineStats: { malicious: 0, suspicious: 0, harmless: 12, undetected: 54 },
      },
    } as never;

    expect(resolvePackageReleaseScanStatus(release)).toBe("pending");
    expect(getPackageDownloadSecurityBlock(release)).toBeNull();
  });

  it("enforces AI VT records when engine stats report suspicious", () => {
    expect(
      resolvePackageReleaseScanStatus({
        vtAnalysis: {
          status: "clean",
          scanner: "code_insight",
          source: "palm",
          engineStats: { malicious: 0, suspicious: 1, harmless: 12, undetected: 54 },
        },
      } as never),
    ).toBe("suspicious");
  });

  it("enforces AI VT records when engine stats report malicious", () => {
    const release = {
      vtAnalysis: {
        status: "clean",
        scanner: "code_insight",
        source: "palm",
        engineStats: { malicious: 1, suspicious: 0, harmless: 12, undetected: 54 },
      },
    } as never;

    expect(resolvePackageReleaseScanStatus(release)).toBe("malicious");
    expect(getPackageDownloadSecurityBlock(release)).toEqual(
      expect.objectContaining({
        status: 403,
      }),
    );
  });

  it("does not let suspicious static scans override clean verification", () => {
    expect(
      resolvePackageReleaseScanStatus({
        staticScan: { status: "suspicious" },
        verification: { scanStatus: "clean" },
      } as never),
    ).toBe("clean");
  });

  it("does not preserve old static-only suspicious verification", () => {
    expect(
      resolvePackageReleaseScanStatus({
        staticScan: { status: "suspicious" },
        verification: { scanStatus: "suspicious" },
        sha256hash: "a".repeat(64),
      } as never),
    ).toBe("pending");
  });

  it("lets package ClawScan clear non-malicious scanner noise", () => {
    expect(
      resolvePackageReleaseScanStatus({
        vtAnalysis: { status: "suspicious" },
        llmAnalysis: { status: "completed", verdict: "benign" },
        verification: { scanStatus: "suspicious" },
      } as never),
    ).toBe("clean");
  });

  it("lets manual package moderation approve or block releases", () => {
    expect(
      resolvePackageReleaseScanStatus({
        staticScan: { status: "malicious" },
        manualModeration: { state: "approved" },
      } as never),
    ).toBe("clean");

    expect(
      getPackageDownloadSecurityBlock({
        verification: { scanStatus: "clean" },
        manualModeration: { state: "quarantined" },
      } as never),
    ).toEqual(
      expect.objectContaining({
        status: 403,
        message: expect.stringContaining("quarantined"),
      }),
    );
  });

  it("explains blocked trust decisions with compact reason codes", () => {
    expect(
      getPackageTrustReasons(
        {
          manualModeration: { state: "quarantined" },
          vtAnalysis: {
            status: "malicious",
            engineStats: { malicious: 1, suspicious: 0, harmless: 12, undetected: 54 },
          },
        } as never,
        "malicious",
        2,
      ),
    ).toEqual(["manual:quarantined", "scan:malicious", "vt:malicious", "reports:2"]);
  });

  it("does not expose AI-only VT advisory statuses as public trust reasons", () => {
    expect(
      getPackageTrustReasons(
        {
          vtAnalysis: {
            status: "malicious",
            scanner: "code_insight",
            source: "palm",
            engineStats: { malicious: 0, suspicious: 0, harmless: 12, undetected: 54 },
          },
        } as never,
        "pending",
      ),
    ).toEqual(["scan:pending"]);
  });

  it("deduplicates overlapping scanner reason codes", () => {
    expect(
      getPackageTrustReasons(
        {
          staticScan: { status: "malicious" },
        } as never,
        "malicious",
      ),
    ).toEqual(["scan:malicious", "static:malicious"]);
  });

  it("keeps clean and not-run releases free of scan reason noise", () => {
    expect(getPackageTrustReasons({} as never, "clean")).toEqual([]);
    expect(getPackageTrustReasons({} as never, "not-run")).toEqual([]);
  });
});
