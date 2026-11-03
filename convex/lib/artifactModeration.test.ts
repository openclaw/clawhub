/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import {
  appendPackageModerationEventLog,
  appendSkillModerationEventLog,
  type ArtifactAppealStatus,
  type ArtifactReportStatus,
  assertArtifactAppealFinalAction,
  assertArtifactAppealTransition,
  assertArtifactReportFinalAction,
  assertArtifactReportTransition,
  readArtifactReportStatus,
} from "./artifactModeration";

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

describe.each(["skill", "package"] as const)("%s moderation event logs", (catalog) => {
  const append =
    catalog === "skill" ? appendSkillModerationEventLog : appendPackageModerationEventLog;
  const table = `${catalog}ModerationEventLogs`;

  it("appends a report timeline entry and its matching audit record", async () => {
    const insert = vi.fn().mockResolvedValue("event:1");
    await append({ db: { insert } } as never, {
      kind: "report",
      reportId: `${catalog}Reports:report` as never,
      actorUserId: "users:moderator" as never,
      action: "report.confirm",
      timelineMetadata: { status: "confirmed" },
      auditAction: "moderation.report.confirm",
      auditTargetType: `${catalog}Report`,
      auditTargetId: "report:1",
      auditMetadata: { reason: "reviewed" },
      createdAt: 123,
    });

    expect(insert.mock.calls).toEqual([
      [
        table,
        {
          kind: "report",
          reportId: `${catalog}Reports:report`,
          actorUserId: "users:moderator",
          action: "report.confirm",
          metadata: { status: "confirmed" },
          createdAt: 123,
        },
      ],
      [
        "auditLogs",
        {
          actorUserId: "users:moderator",
          action: "moderation.report.confirm",
          targetType: `${catalog}Report`,
          targetId: "report:1",
          metadata: { reason: "reviewed" },
          createdAt: 123,
        },
      ],
    ]);
  });

  it("appends an appeal and audit record without absent optional fields", async () => {
    const insert = vi.fn().mockResolvedValue("event:1");
    await append({ db: { insert } } as never, {
      kind: "appeal",
      appealId: `${catalog}Appeals:appeal` as never,
      actorUserId: "users:moderator" as never,
      action: "appeal.accept",
      auditAction: "moderation.appeal.accept",
      auditTargetType: `${catalog}Appeal`,
      auditTargetId: "appeal:1",
      createdAt: 456,
    });

    expect(insert.mock.calls).toEqual([
      [
        table,
        {
          kind: "appeal",
          appealId: `${catalog}Appeals:appeal`,
          actorUserId: "users:moderator",
          action: "appeal.accept",
          createdAt: 456,
        },
      ],
      [
        "auditLogs",
        {
          actorUserId: "users:moderator",
          action: "moderation.appeal.accept",
          targetType: `${catalog}Appeal`,
          targetId: "appeal:1",
          createdAt: 456,
        },
      ],
    ]);
  });
});
