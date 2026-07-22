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

  it("does not block VT-only malicious package releases", () => {
    expect(isPackageBlockedFromPublic("malicious")).toBe(true);
    expect(
      getPackageDownloadSecurityBlock({
        vtAnalysis: {
          status: "malicious",
          source: "engines",
          engineStats: { malicious: 1, suspicious: 0, harmless: 12, undetected: 54 },
        },
      } as never),
    ).toBeNull();
  });

  it("keeps legacy VT suspicious status as telemetry when engines are clean", () => {
    const release = {
      sha256hash: "a".repeat(64),
      vtAnalysis: {
        status: "suspicious",
        scanner: "legacy-ai",
        source: "legacy-ai",
        engineStats: { malicious: 0, suspicious: 0, harmless: 12, undetected: 54 },
      },
    } as never;

    expect(resolvePackageReleaseScanStatus(release)).toBe("pending");
    expect(getPackageDownloadSecurityBlock(release)).toBeNull();
  });

  it("keeps legacy VT malicious status as telemetry when engines are clean", () => {
    const release = {
      sha256hash: "a".repeat(64),
      vtAnalysis: {
        status: "malicious",
        scanner: "legacy-ai",
        source: "legacy-ai",
        engineStats: { malicious: 0, suspicious: 0, harmless: 12, undetected: 54 },
      },
    } as never;

    expect(resolvePackageReleaseScanStatus(release)).toBe("pending");
    expect(getPackageDownloadSecurityBlock(release)).toBeNull();
  });

  it("keeps engine-backed VT suspicious as telemetry", () => {
    expect(
      resolvePackageReleaseScanStatus({
        vtAnalysis: {
          status: "clean",
          scanner: "legacy-ai",
          source: "legacy-ai",
          engineStats: { malicious: 0, suspicious: 1, harmless: 12, undetected: 54 },
        },
      } as never),
    ).toBe("not-run");
  });

  it("keeps engine-backed VT malicious as telemetry", () => {
    const release = {
      vtAnalysis: {
        status: "clean",
        scanner: "legacy-ai",
        source: "legacy-ai",
        engineStats: { malicious: 1, suspicious: 0, harmless: 12, undetected: 54 },
      },
    } as never;

    expect(resolvePackageReleaseScanStatus(release)).toBe("not-run");
    expect(getPackageDownloadSecurityBlock(release)).toBeNull();
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

  it("does not preserve old static-only malicious verification", () => {
    expect(
      resolvePackageReleaseScanStatus({
        staticScan: { status: "malicious" },
        verification: { scanStatus: "malicious" },
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

  it("lets package ClawScan clear a static malicious hold", () => {
    expect(
      resolvePackageReleaseScanStatus({
        staticScan: { status: "malicious" },
        llmAnalysis: { status: "clean", verdict: "benign" },
      } as never),
    ).toBe("clean");
  });

  it("trusts verified OpenClaw plugins while Codex reviews static holds", () => {
    const release = {
      staticScan: { status: "malicious" },
      verification: { scanStatus: "clean", trustedOpenClawPlugin: true },
    } as never;

    expect(resolvePackageReleaseScanStatus(release)).toBe("clean");
    expect(getPackageDownloadSecurityBlock(release)).toBeNull();
  });

  it("keeps static malicious package scans advisory until ClawScan decides", () => {
    const release = {
      staticScan: { status: "malicious" },
      sha256hash: "a".repeat(64),
    } as never;

    expect(resolvePackageReleaseScanStatus(release)).toBe("pending");
    expect(getPackageDownloadSecurityBlock(release)).toBeNull();
  });

  it("keeps ordinary dependency vulnerabilities advisory", () => {
    const release = {
      dependencyScan: {
        status: "suspicious",
        findings: [{ classification: "vulnerability", confidence: "medium" }],
      },
      staticScan: { status: "clean" },
      verification: { scanStatus: "pending" },
      sha256hash: "a".repeat(64),
    } as never;

    expect(resolvePackageReleaseScanStatus(release)).toBe("pending");
    expect(getPackageDownloadSecurityBlock(release)).toBeNull();
  });

  it("does not block low-confidence dependency scan statuses", () => {
    const release = {
      dependencyScan: {
        status: "malicious",
        findings: [{ classification: "malware", confidence: "medium" }],
      },
      verification: { scanStatus: "pending" },
      sha256hash: "a".repeat(64),
    } as never;

    expect(resolvePackageReleaseScanStatus(release)).toBe("pending");
    expect(getPackageDownloadSecurityBlock(release)).toBeNull();
  });

  it("blocks package releases with malicious dependency scan results", () => {
    const release = {
      dependencyScan: {
        status: "malicious",
        findings: [
          {
            classification: "malware",
            confidence: "high",
            advisoryId: "MAL-2026-1234",
          },
        ],
      },
      verification: { scanStatus: "pending" },
      llmAnalysis: { status: "clean", verdict: "benign" },
      sha256hash: "a".repeat(64),
    } as never;

    expect(resolvePackageReleaseScanStatus(release)).toBe("malicious");
    expect(getPackageDownloadSecurityBlock(release)).toEqual(
      expect.objectContaining({
        status: 403,
        message: expect.stringContaining("malicious"),
      }),
    );
  });

  it("does not let stale manual approval override later dependency malware", () => {
    const release = {
      dependencyScan: {
        status: "malicious",
        checkedAt: 2,
        findings: [
          {
            classification: "malware",
            confidence: "high",
            advisoryId: "MAL-2026-1234",
          },
        ],
      },
      manualModeration: { state: "approved", updatedAt: 1 },
      verification: { scanStatus: "pending" },
      sha256hash: "a".repeat(64),
    } as never;

    expect(resolvePackageReleaseScanStatus(release)).toBe("malicious");
    expect(getPackageDownloadSecurityBlock(release)).toEqual(
      expect.objectContaining({
        status: 403,
        message: expect.stringContaining("malicious"),
      }),
    );
  });

  it("lets newer manual approval clear dependency malware", () => {
    const release = {
      dependencyScan: {
        status: "malicious",
        checkedAt: 2,
        findings: [
          {
            classification: "malware",
            confidence: "high",
            advisoryId: "MAL-2026-1234",
          },
        ],
      },
      manualModeration: { state: "approved", updatedAt: 3 },
      verification: { scanStatus: "pending" },
      sha256hash: "a".repeat(64),
    } as never;

    expect(resolvePackageReleaseScanStatus(release)).toBe("clean");
    expect(getPackageDownloadSecurityBlock(release)).toBeNull();
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
    ).toEqual(["manual:quarantined", "scan:malicious", "reports:2"]);
  });

  it("does not expose legacy VT-only statuses as public trust reasons", () => {
    expect(
      getPackageTrustReasons(
        {
          vtAnalysis: {
            status: "malicious",
            scanner: "legacy-ai",
            source: "legacy-ai",
            engineStats: { malicious: 0, suspicious: 0, harmless: 12, undetected: 54 },
          },
        } as never,
        "pending",
      ),
    ).toEqual(["scan:pending"]);
  });

  it("keeps static-only package findings out of trust reason codes", () => {
    expect(
      getPackageTrustReasons(
        {
          staticScan: { status: "malicious" },
        } as never,
        "malicious",
      ),
    ).toEqual(["scan:malicious"]);
  });

  it("keeps clean and not-run releases free of scan reason noise", () => {
    expect(getPackageTrustReasons({} as never, "clean")).toEqual([]);
    expect(getPackageTrustReasons({} as never, "not-run")).toEqual([]);
  });
});
