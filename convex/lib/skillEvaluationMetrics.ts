import { type Infer, v } from "convex/values";

export const skillEvaluationMetricsValidator = v.object({
  sampleCount: v.number(),
  overall: v.object({
    withSkill: v.number(),
    withoutSkill: v.number(),
    delta: v.number(),
  }),
  cases: v.object({
    withSkillPassed: v.number(),
    withSkillTotal: v.number(),
    withoutSkillPassed: v.number(),
    withoutSkillTotal: v.number(),
  }),
  dimensions: v.array(
    v.object({
      id: v.string(),
      withSkill: v.number(),
      withoutSkill: v.number(),
      delta: v.number(),
    }),
  ),
});

export type SkillEvaluationMetrics = Infer<typeof skillEvaluationMetricsValidator>;
