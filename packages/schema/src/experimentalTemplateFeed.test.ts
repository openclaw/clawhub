import { describe, expect, it } from "vitest";
import {
  EXPERIMENTAL_TEMPLATE_FEED_ID,
  EXPERIMENTAL_TEMPLATE_FEED_SCHEMA_VERSION,
  parseExperimentalTemplateFeed,
  serializeExperimentalTemplateFeed,
  type ExperimentalTemplateFeed,
} from "./experimentalTemplateFeed.js";

function makeFeed(): ExperimentalTemplateFeed {
  return {
    schemaVersion: EXPERIMENTAL_TEMPLATE_FEED_SCHEMA_VERSION,
    id: EXPERIMENTAL_TEMPLATE_FEED_ID,
    generatedAt: "2026-07-19T00:00:00.000Z",
    sequence: 1,
    expiresAt: "2026-07-20T00:00:00.000Z",
    entries: [
      {
        type: "template",
        id: "@openclaw/triage",
        title: "Triage",
        version: "1.0.0",
        state: "available",
        publisher: { id: "openclaw", trust: "official" },
        templateManifestSummary: {
          schemaVersion: 1,
          agent: { id: "triage", name: "Triage" },
          workspace: { bootstrapFiles: ["SOUL.md", "AGENTS.md"], fileCount: 2 },
          packages: { skillCount: 1, pluginCount: 0 },
          profiles: { count: 2, hasOpenClaw: true },
          extensions: { count: 1 },
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

describe("experimental Template feed schema", () => {
  it("round-trips bounded Template summaries with canonical bootstrap ordering", () => {
    const first = makeFeed();
    const second = structuredClone(first);
    second.entries[0]!.templateManifestSummary.workspace.bootstrapFiles.reverse();

    expect(serializeExperimentalTemplateFeed(first)).toBe(
      serializeExperimentalTemplateFeed(second),
    );
    expect(
      parseExperimentalTemplateFeed(JSON.parse(serializeExperimentalTemplateFeed(first)))
        .entries[0],
    ).toMatchObject({
      type: "template",
      templateManifestSummary: {
        agent: { id: "triage" },
        profiles: { count: 2, hasOpenClaw: true },
        extensions: { count: 1 },
      },
    });
  });

  it("rejects generic feed ids and non-Template entries", () => {
    expect(() => parseExperimentalTemplateFeed({ ...makeFeed(), id: "clawhub-official" })).toThrow(
      "feed id",
    );
    expect(() =>
      parseExperimentalTemplateFeed({
        ...makeFeed(),
        entries: [{ ...makeFeed().entries[0], type: "plugin" }],
      }),
    ).toThrow();
  });

  it("rejects install candidates outside the public ClawHub source profile", () => {
    const feed = makeFeed();
    feed.entries[0]!.install.candidates[0]!.sourceRef = "public-github" as "public-clawhub";
    expect(() => parseExperimentalTemplateFeed(feed)).toThrow();
  });

  it("rejects install candidates that are not bound to their feed entry", () => {
    const packageMismatch = makeFeed();
    packageMismatch.entries[0]!.install.candidates[0]!.package = "@openclaw/other";
    expect(() => parseExperimentalTemplateFeed(packageMismatch)).toThrow(
      "package must match entry id",
    );

    const versionMismatch = makeFeed();
    versionMismatch.entries[0]!.install.candidates[0]!.version = "2.0.0";
    expect(() => parseExperimentalTemplateFeed(versionMismatch)).toThrow(
      "version must match entry version",
    );
  });

  it("requires exactly one install candidate per entry", () => {
    const missing = makeFeed();
    missing.entries[0]!.install.candidates = [];
    expect(() => parseExperimentalTemplateFeed(missing)).toThrow("exactly one install candidate");

    const duplicate = makeFeed();
    duplicate.entries[0]!.install.candidates.push(
      structuredClone(duplicate.entries[0]!.install.candidates[0]!),
    );
    expect(() => parseExperimentalTemplateFeed(duplicate)).toThrow("exactly one install candidate");
  });

  it("rejects entries that are not from official publishers", () => {
    const feed = makeFeed();
    feed.entries[0]!.publisher.trust = "community";
    expect(() => parseExperimentalTemplateFeed(feed)).toThrow("publisher trust must be official");
  });

  it.each(["sha256:abc", `sha256:${"A".repeat(64)}`, `sha512:${"a".repeat(64)}`])(
    "rejects non-canonical candidate integrity %s",
    (integrity) => {
      const feed = makeFeed();
      feed.entries[0]!.install.candidates[0]!.integrity = integrity;
      expect(() => parseExperimentalTemplateFeed(feed)).toThrow(
        "integrity must be lowercase sha256 with 64 hex characters",
      );
    },
  );
});
