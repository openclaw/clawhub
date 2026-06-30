/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  normalizeFindings,
  parsePackageNames,
  resolveArtifactKind,
} from "./package-inspector-nightly-scan";

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
});
