import { describe, expect, it } from "vitest";
import {
  EXPERIMENTAL_CLAW_FEED_ID,
  EXPERIMENTAL_CLAW_FEED_SCHEMA_VERSION,
  parseExperimentalClawFeed,
  serializeExperimentalClawFeed,
  type ExperimentalClawFeed,
} from "./experimentalClawFeed.js";

function makeFeed(): ExperimentalClawFeed {
  return {
    schemaVersion: EXPERIMENTAL_CLAW_FEED_SCHEMA_VERSION,
    id: EXPERIMENTAL_CLAW_FEED_ID,
    generatedAt: "2026-07-19T00:00:00.000Z",
    sequence: 1,
    expiresAt: "2026-07-20T00:00:00.000Z",
    entries: [
      {
        type: "claw",
        id: "@openclaw/triage",
        title: "Triage",
        version: "1.0.0",
        state: "available",
        publisher: { id: "openclaw", trust: "official" },
        clawManifestSummary: {
          schemaVersion: 1,
          agent: { id: "triage", name: "Triage" },
          workspace: { bootstrapFiles: ["SOUL.md", "AGENTS.md"], fileCount: 2 },
          packages: { skillCount: 1, pluginCount: 0 },
          mcpServerCount: 0,
          cronJobCount: 1,
        },
        install: {
          candidates: [
            {
              sourceRef: "public-clawhub",
              package: "@openclaw/triage",
              version: "1.0.0",
              integrity: `sha256:${"a".repeat(64)}`,
            },
          ],
        },
      },
    ],
  };
}

describe("experimental Claw feed schema", () => {
  it("round-trips bounded Claw summaries with canonical bootstrap ordering", () => {
    const first = makeFeed();
    const second = structuredClone(first);
    second.entries[0]!.clawManifestSummary.workspace.bootstrapFiles.reverse();

    expect(serializeExperimentalClawFeed(first)).toBe(serializeExperimentalClawFeed(second));
    expect(
      parseExperimentalClawFeed(JSON.parse(serializeExperimentalClawFeed(first))).entries[0],
    ).toMatchObject({ type: "claw", clawManifestSummary: { agent: { id: "triage" } } });
  });

  it("rejects generic feed ids and non-Claw entries", () => {
    expect(() => parseExperimentalClawFeed({ ...makeFeed(), id: "clawhub-official" })).toThrow(
      "feed id",
    );
    expect(() =>
      parseExperimentalClawFeed({
        ...makeFeed(),
        entries: [{ ...makeFeed().entries[0], type: "plugin" }],
      }),
    ).toThrow();
  });

  it("rejects install candidates outside the public ClawHub source profile", () => {
    const feed = makeFeed();
    feed.entries[0]!.install.candidates[0]!.sourceRef = "public-github" as "public-clawhub";
    expect(() => parseExperimentalClawFeed(feed)).toThrow();
  });

  it("rejects install candidates that are not bound to their feed entry", () => {
    const packageMismatch = makeFeed();
    packageMismatch.entries[0]!.install.candidates[0]!.package = "@openclaw/other";
    expect(() => parseExperimentalClawFeed(packageMismatch)).toThrow("package must match entry id");

    const versionMismatch = makeFeed();
    versionMismatch.entries[0]!.install.candidates[0]!.version = "2.0.0";
    expect(() => parseExperimentalClawFeed(versionMismatch)).toThrow(
      "version must match entry version",
    );
  });

  it("requires exactly one install candidate per entry", () => {
    const missing = makeFeed();
    missing.entries[0]!.install.candidates = [];
    expect(() => parseExperimentalClawFeed(missing)).toThrow("exactly one install candidate");

    const duplicate = makeFeed();
    duplicate.entries[0]!.install.candidates.push(
      structuredClone(duplicate.entries[0]!.install.candidates[0]!),
    );
    expect(() => parseExperimentalClawFeed(duplicate)).toThrow("exactly one install candidate");
  });

  it("rejects entries that are not from official publishers", () => {
    const feed = makeFeed();
    feed.entries[0]!.publisher.trust = "community";
    expect(() => parseExperimentalClawFeed(feed)).toThrow("publisher trust must be official");
  });

  it.each(["sha256:abc", `sha256:${"A".repeat(64)}`, `sha512:${"a".repeat(64)}`])(
    "rejects non-canonical candidate integrity %s",
    (integrity) => {
      const feed = makeFeed();
      feed.entries[0]!.install.candidates[0]!.integrity = integrity;
      expect(() => parseExperimentalClawFeed(feed)).toThrow(
        "integrity must be lowercase sha256 with 64 hex characters",
      );
    },
  );
});
