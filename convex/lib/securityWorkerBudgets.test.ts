import { describe, expect, it } from "vitest";
import {
  canAdmitSecurityScan,
  pluginScanBudget,
  publicationCheckLeaseMs,
  securityScanLeaseMs,
  securityWorkerDeadline,
} from "./securityWorkerBudgets";

const minute = 60_000;
describe("plugin scan deadline hierarchy", () => {
  it("covers native MCP 30m, judge 20m, overview 5m and process/container cleanup", () => {
    expect(pluginScanBudget.subprocessMs).toBe(60 * minute);
    expect(pluginScanBudget.subprocessMs).toBeGreaterThan((30 + 20 + 5) * minute);
    expect(pluginScanBudget.publicationJobMs).toBe(65 * minute);
    expect(publicationCheckLeaseMs("package", "code-plugin")).toBe(70 * minute);
    expect(publicationCheckLeaseMs("package", "bundle-plugin")).toBe(70 * minute);
    expect(publicationCheckLeaseMs("package", undefined)).toBe(70 * minute);
    expect(publicationCheckLeaseMs("skill", undefined)).toBe(30 * minute);
    expect(publicationCheckLeaseMs("package", "claw")).toBe(30 * minute);
  });
  it("covers sequential optional Endor plus MCP in explicit rescans without extending skill/report-only leases", () => {
    expect(pluginScanBudget.manualJobMs).toBe(85 * minute);
    expect(securityScanLeaseMs("packageRelease", undefined, minute)).toBe(90 * minute);
    expect(securityScanLeaseMs("packageRelease", "endor-report-only", minute)).toBe(minute);
    expect(securityScanLeaseMs("skillVersion", undefined, minute)).toBe(minute);
    expect(securityScanLeaseMs("skillVersion", undefined, 120 * minute)).toBe(60 * minute);
  });
  it("refuses late claims including the first, while permitting already claimed work to drain", () => {
    expect(canAdmitSecurityScan(0, 15 * minute, 75 * minute, 65 * minute)).toBe(true);
    expect(canAdmitSecurityScan(10 * minute, 15 * minute, 75 * minute, 65 * minute)).toBe(true);
    expect(canAdmitSecurityScan(10 * minute + 1, 15 * minute, 75 * minute, 65 * minute)).toBe(
      false,
    );
    expect(canAdmitSecurityScan(0, 15 * minute, 60 * minute, 65 * minute)).toBe(false);
    expect(canAdmitSecurityScan(15 * minute, 15 * minute, 100 * minute, 65 * minute)).toBe(false);
  });
});

it("deducts setup time from hosted drain coverage and rejects malformed deadlines", () => {
  expect(securityWorkerDeadline(40 * minute, 75 * minute, String(98 * minute))).toBe(98 * minute);
  expect(canAdmitSecurityScan(40 * minute, 55 * minute, 98 * minute, 65 * minute)).toBe(false);
  expect(securityWorkerDeadline(0, 75 * minute, String(98 * minute))).toBe(75 * minute);
  expect(securityWorkerDeadline(0, 75 * minute, undefined)).toBe(75 * minute);
  expect(() => securityWorkerDeadline(0, 75 * minute, "invalid")).toThrow("Invalid hosted");
});
