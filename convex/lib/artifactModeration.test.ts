/* @vitest-environment node */

import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  type ArtifactAppealStatus,
  type ArtifactReportStatus,
  assertArtifactAppealFinalAction,
  assertArtifactAppealTransition,
  assertArtifactReportFinalAction,
  assertArtifactReportTransition,
  readArtifactReportStatus,
} from "./artifactModeration";

const repoRoot = new URL("../../", import.meta.url);
const convexRoot = new URL("convex/", repoRoot);
const eventLogTables = ["skillModerationEventLogs", "packageModerationEventLogs"] as const;

async function listSourceFiles(dir: URL): Promise<URL[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: URL[] = [];
  for (const entry of entries) {
    if (entry.name === "_generated") continue;
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(child)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(child);
    }
  }
  return files;
}

describe("artifact moderation state graph", () => {
  it.each([
    ["open", "confirmed"],
    ["open", "dismissed"],
    ["confirmed", "open"],
    ["dismissed", "open"],
    [undefined, "confirmed"],
    [undefined, "dismissed"],
  ] satisfies Array<[ArtifactReportStatus | undefined, ArtifactReportStatus]>)(
    "allows report transition %s -> %s",
    (from, to) => {
      expect(() => assertArtifactReportTransition(from, to)).not.toThrow();
    },
  );

  it.each([
    ["open", "open"],
    ["confirmed", "confirmed"],
    ["dismissed", "dismissed"],
    ["confirmed", "dismissed"],
    ["dismissed", "confirmed"],
    [undefined, "open"],
  ] satisfies Array<[ArtifactReportStatus | undefined, ArtifactReportStatus]>)(
    "blocks report transition %s -> %s",
    (from, to) => {
      expect(() => assertArtifactReportTransition(from, to)).toThrow(
        "Invalid report status transition",
      );
    },
  );

  it.each([
    ["confirmed", "hide"],
    ["confirmed", "quarantine"],
    ["confirmed", "revoke"],
    ["open", "none"],
    ["confirmed", "none"],
    ["dismissed", "none"],
  ] satisfies Array<[ArtifactReportStatus, "none" | "hide" | "quarantine" | "revoke"]>)(
    "allows report final action %s + %s",
    (status, action) => {
      expect(() =>
        assertArtifactReportFinalAction(status, action, ["hide", "quarantine", "revoke"]),
      ).not.toThrow();
    },
  );

  it("reads legacy triaged report statuses as confirmed", () => {
    expect(readArtifactReportStatus("triaged")).toBe("confirmed");
  });

  it.each([
    ["open", "hide", "Reopened reports cannot apply a final action."],
    ["dismissed", "hide", "Dismissed reports cannot apply a final action."],
    ["confirmed", "restore", "Unsupported report final action: restore."],
  ] satisfies Array<[ArtifactReportStatus, "hide" | "restore", string]>)(
    "blocks report final action %s + %s",
    (status, action, message) => {
      expect(() =>
        assertArtifactReportFinalAction(status, action, ["hide", "quarantine", "revoke"]),
      ).toThrow(message);
    },
  );

  it.each([
    ["open", "accepted"],
    ["open", "rejected"],
    ["accepted", "open"],
    ["rejected", "open"],
    [undefined, "accepted"],
    [undefined, "rejected"],
  ] satisfies Array<[ArtifactAppealStatus | undefined, ArtifactAppealStatus]>)(
    "allows appeal transition %s -> %s",
    (from, to) => {
      expect(() => assertArtifactAppealTransition(from, to)).not.toThrow();
    },
  );

  it.each([
    ["open", "open"],
    ["accepted", "accepted"],
    ["rejected", "rejected"],
    ["accepted", "rejected"],
    ["rejected", "accepted"],
    [undefined, "open"],
  ] satisfies Array<[ArtifactAppealStatus | undefined, ArtifactAppealStatus]>)(
    "blocks appeal transition %s -> %s",
    (from, to) => {
      expect(() => assertArtifactAppealTransition(from, to)).toThrow(
        "Invalid appeal status transition",
      );
    },
  );

  it.each([
    ["accepted", "restore"],
    ["accepted", "approve"],
    ["open", "none"],
    ["accepted", "none"],
    ["rejected", "none"],
  ] satisfies Array<[ArtifactAppealStatus, "none" | "restore" | "approve"]>)(
    "allows appeal final action %s + %s",
    (status, action) => {
      expect(() =>
        assertArtifactAppealFinalAction(status, action, ["restore", "approve"]),
      ).not.toThrow();
    },
  );

  it.each([
    ["open", "restore", "Reopened appeals cannot apply a final action."],
    ["rejected", "restore", "Rejected appeals cannot apply a final action."],
    ["accepted", "hide", "Unsupported appeal final action: hide."],
  ] satisfies Array<[ArtifactAppealStatus, "restore" | "hide", string]>)(
    "blocks appeal final action %s + %s",
    (status, action, message) => {
      expect(() => assertArtifactAppealFinalAction(status, action, ["restore", "approve"])).toThrow(
        message,
      );
    },
  );
});

describe("artifact moderation event logs", () => {
  it("keeps event log writes behind append helpers", async () => {
    const files = await listSourceFiles(convexRoot);
    const insertReferences: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const table of eventLogTables) {
        if (source.includes(`insert("${table}"`)) {
          insertReferences.push(file.pathname.replace(repoRoot.pathname, ""));
        }
      }
    }

    expect([...new Set(insertReferences)]).toEqual(["convex/lib/artifactModeration.ts"]);
  });

  it("does not patch, replace, or delete event log tables by name", async () => {
    const files = await listSourceFiles(convexRoot);
    const forbiddenReferences: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const table of eventLogTables) {
        const forbiddenWrite = new RegExp(`\\.(patch|replace|delete)\\(\\s*["']${table}["']`);
        if (forbiddenWrite.test(source)) {
          forbiddenReferences.push(file.pathname.replace(repoRoot.pathname, ""));
        }
      }
    }

    expect(forbiddenReferences).toEqual([]);
  });
});
