/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { appealModerationPlan, reportModerationPlan } from "./moderationPlan";

describe("moderation plan summaries", () => {
  it.each([
    {
      name: "confirmed skill report with hide",
      plan: reportModerationPlan({
        entityLabel: "skill",
        reportId: "skillReports:1",
        status: "confirmed",
        finalAction: "hide",
      }),
      expected: {
        subject: "skill report skillReports:1",
        outcome: "set status to confirmed; final action hide",
        impacts: ["Mark the report as confirmed.", "Hide the skill from public availability."],
        requiresConfirmation: true,
      },
    },
    {
      name: "dismissed package report with no final action",
      plan: reportModerationPlan({
        entityLabel: "package",
        reportId: "packageReports:1",
        status: "dismissed",
        finalAction: "none",
      }),
      expected: {
        subject: "package report packageReports:1",
        outcome: "set status to dismissed; final action none",
        impacts: ["Dismiss the report without changing artifact availability."],
        requiresConfirmation: false,
      },
    },
    {
      name: "accepted skill appeal with restore",
      plan: appealModerationPlan({
        entityLabel: "skill",
        appealId: "skillAppeals:1",
        status: "accepted",
        finalAction: "restore",
      }),
      expected: {
        subject: "skill appeal skillAppeals:1",
        outcome: "set status to accepted; final action restore",
        impacts: ["Accept the appeal.", "Restore the skill to public availability."],
        requiresConfirmation: true,
      },
    },
    {
      name: "accepted package appeal with approve",
      plan: appealModerationPlan({
        entityLabel: "package",
        appealId: "packageAppeals:1",
        status: "accepted",
        finalAction: "approve",
      }),
      expected: {
        subject: "package appeal packageAppeals:1",
        outcome: "set status to accepted; final action approve",
        impacts: ["Accept the appeal.", "Approve the package release."],
        requiresConfirmation: true,
      },
    },
  ])("describes $name", ({ plan, expected }) => {
    expect(plan).toMatchObject(expected);
  });
});
