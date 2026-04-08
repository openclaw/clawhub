import { describe, expect, it } from "vitest";
import {
  getPackageDownloadSecurityBlock,
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

  it("still blocks malicious package releases", () => {
    expect(isPackageBlockedFromPublic("malicious")).toBe(true);
    expect(
      getPackageDownloadSecurityBlock({
        vtAnalysis: { status: "malicious" },
      } as never),
    ).toEqual(
      expect.objectContaining({
        status: 403,
      }),
    );
  });

  it("treats suspicious static scans as suspicious even when verification is clean", () => {
    expect(
      resolvePackageReleaseScanStatus({
        staticScan: { status: "suspicious" },
        verification: { scanStatus: "clean" },
      } as never),
    ).toBe("suspicious");
  });
});
