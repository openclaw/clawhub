import { type Infer, v } from "convex/values";

export const skillLeaderboardEntryValidator = v.object({
  skillId: v.id("skills"),
  score: v.number(),
  installs: v.number(),
  downloads: v.number(),
});

export const packageLeaderboardEntryValidator = v.object({
  packageId: v.id("packages"),
  score: v.number(),
  installs: v.number(),
  downloads: v.number(),
});

export type LeaderboardEntry = Infer<typeof skillLeaderboardEntryValidator>;
