/* @vitest-environment node */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { projectStoredTemplateFeed } from "./templateFeedStorage";

const historical = JSON.parse(
  readFileSync(
    new URL("../../fixtures/templates/historical-published-v1.json", import.meta.url),
    "utf8",
  ),
);
const legacy = () => ({
  schemaVersion: 1,
  id: "clawhub-official-claws",
  sequence: historical.source.sequence,
  generatedAt: historical.source.generatedAt,
  expiresAt: "2026-10-29T00:46:01.333Z",
  description: "Claws published by verified OpenClaw publishers on ClawHub.",
  entries: [structuredClone(historical.entry)],
});

describe("historical Template snapshot wire projection", () => {
  it("projects an observed published 0.1.1 entry without changing identity, archive integrity or stored bytes", () => {
    const old = JSON.stringify(legacy());
    const projected = projectStoredTemplateFeed(old);
    expect(projected?.entryCount).toBe(1);
    const feed = JSON.parse(projected!.payload);
    expect(feed).toMatchObject({
      id: "clawhub-official-templates",
      sequence: 59,
      entries: [
        {
          type: "template",
          id: historical.entry.id,
          version: "0.1.1",
          templateManifestSummary: historical.entry.clawManifestSummary,
          install: historical.entry.install,
        },
      ],
    });
    expect(feed.entries[0]).not.toHaveProperty("clawManifestSummary");
    expect(JSON.parse(old)).toEqual(legacy());
    expect(projectStoredTemplateFeed(projected!.payload)).toEqual(projected);
  });

  it("retains all 150 concrete old-shaped entries in deterministic canonical output", () => {
    const feed = legacy();
    feed.entries = Array.from({ length: 150 }, (_, i) => {
      const entry = structuredClone(historical.entry);
      entry.id = `@openclaw/historical-fixture-${i}`;
      entry.install.candidates[0].package = entry.id;
      return entry;
    });
    const projected = projectStoredTemplateFeed(JSON.stringify(feed));
    expect(projected?.entryCount).toBe(150);
    expect(
      new Set(JSON.parse(projected!.payload).entries.map((entry: { id: string }) => entry.id)).size,
    ).toBe(150);
  });

  it("fails closed on invalid, mixed or noncanonical publisher/candidate payloads", () => {
    for (const corrupt of [
      (v: ReturnType<typeof legacy>) => {
        v.entries[0].type = "template";
      },
      (v: ReturnType<typeof legacy>) => {
        v.entries[0].publisher.id = "other";
      },
      (v: ReturnType<typeof legacy>) => {
        v.entries[0].install.candidates[0].version = "99.0.0";
      },
      (v: ReturnType<typeof legacy>) => {
        v.id = "unknown-feed";
      },
    ]) {
      const value = legacy();
      corrupt(value);
      expect(projectStoredTemplateFeed(JSON.stringify(value))).toBeNull();
    }
  });
});
