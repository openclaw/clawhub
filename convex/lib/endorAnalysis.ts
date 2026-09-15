import { zodToConvex } from "convex-helpers/server/zod4";
import { z } from "zod";

export const endorAnalysisSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("completed"),
    checkedAt: z.number().finite(),
    reachableFunctionCount: z.number().int().nonnegative(),
    findings: z
      .array(z.object({ severity: z.string().max(64), summary: z.string().max(2000) }))
      .max(50),
  }),
  z.object({
    status: z.literal("skipped"),
    checkedAt: z.number().finite(),
    reason: z.string().max(2000),
  }),
]);

export const endorAnalysisValidator = zodToConvex(endorAnalysisSchema);
export type EndorAnalysis = z.infer<typeof endorAnalysisSchema>;
