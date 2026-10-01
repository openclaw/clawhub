/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { reportModerationPlan } from "./moderationPlan";

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
  ])("describes $name", ({ plan, expected }) => {
    expect(plan).toMatchObject(expected);
  });
});
