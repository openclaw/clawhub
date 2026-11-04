import { type Infer, v } from "convex/values";

export const storedTemporalBenchmarkValidator = v.object({
  scope: v.optional(v.literal("all_active_skills")),
  sampleSize: v.number(),
  downloads30dAverage: v.number(),
  downloads30dMedian: v.number(),
  downloads30dP95: v.number(),
  downloads30dP99: v.number(),
  spikeMultiplier7dP95: v.number(),
  spikeMultiplier7dP99: v.number(),
  excess7DownloadsP95: v.optional(v.number()),
  excess7DownloadsP99: v.optional(v.number()),
});

export const temporalBenchmarkValidator = storedTemporalBenchmarkValidator.extend({
  excess7DownloadsP95: v.number(),
  excess7DownloadsP99: v.number(),
});

export type TemporalAbuseCohortBenchmark = Infer<typeof temporalBenchmarkValidator>;
export type StoredTemporalAbuseCohortBenchmark = Infer<typeof storedTemporalBenchmarkValidator>;
