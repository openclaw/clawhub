import { v } from "convex/values";

export const publisherAbusePortfolioEvidenceValidator = v.object({
  skillCount: v.number(),
  publisherSkillCount: v.number(),
  allPublisherSkills: v.boolean(),
  correlationFloor: v.number(),
  correlationMedian: v.number(),
  peak7DownloadsMin: v.number(),
  peak7DownloadsMax: v.number(),
  catalogCoverage: v.number(),
  windowStartDay: v.number(),
  windowEndDay: v.number(),
});
