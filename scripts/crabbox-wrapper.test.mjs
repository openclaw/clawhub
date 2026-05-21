/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  assertRequiredCrabboxCapabilities,
  inspectCrabboxCapabilities,
  normalizeCrabboxArgs,
  requiresDesktopSupport,
  selectCrabboxBinary,
} from "./crabbox-wrapper.mjs";

describe("crabbox-wrapper", () => {
  it("normalizes package-manager separators without eating remote command separators", () => {
    expect(normalizeCrabboxArgs(["--", "run", "--provider", "blacksmith-testbox"])).toEqual([
      "run",
      "--provider",
      "blacksmith-testbox",
    ]);
    expect(normalizeCrabboxArgs(["actions", "hydrate", "--", "--id", "cbx_123"])).toEqual([
      "actions",
      "hydrate",
      "--id",
      "cbx_123",
    ]);
    expect(normalizeCrabboxArgs(["run", "--provider", "hetzner", "--", "bun", "test"])).toEqual([
      "run",
      "--provider",
      "hetzner",
      "--",
      "bun",
      "test",
    ]);
  });

  it("prefers a sibling Crabbox checkout when it exists", () => {
    expect(
      selectCrabboxBinary({
        exists: (candidate) => candidate === "/repo/crabbox/bin/crabbox",
        repoRoot: "/repo/clawhub",
      }),
    ).toBe("/repo/crabbox/bin/crabbox");
  });

  it("rejects stale Crabbox binaries that cannot wrap Blacksmith Testbox", () => {
    const capabilities = inspectCrabboxCapabilities({
      runHelp: "Usage: crabbox run --provider aws|hetzner",
      topLevelHelp: "Usage: crabbox run",
      versionText: "crabbox v0.4.0",
    });

    expect(() =>
      assertRequiredCrabboxCapabilities(capabilities, { requireDesktop: false }),
    ).toThrow(/blacksmith-testbox/u);
  });

  it("rejects stale Crabbox binaries for desktop UI proof commands", () => {
    const capabilities = inspectCrabboxCapabilities({
      runHelp: "Usage: crabbox run --provider aws|hetzner|blacksmith-testbox",
      topLevelHelp: "Usage: crabbox run\ncrabbox screenshot",
      versionText: "crabbox v0.5.0",
    });

    expect(() => assertRequiredCrabboxCapabilities(capabilities, { requireDesktop: true })).toThrow(
      /desktop.*artifacts/u,
    );
  });

  it("requires desktop support when run flags request browser or desktop leases", () => {
    expect(requiresDesktopSupport(["run", "--provider", "hetzner", "--desktop"])).toBe(true);
    expect(requiresDesktopSupport(["warmup", "--provider", "hetzner", "--browser"])).toBe(true);
    expect(requiresDesktopSupport(["run", "--provider", "blacksmith-testbox"])).toBe(false);
  });
});
