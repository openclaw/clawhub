import { v } from "convex/values";
import { query } from "./_generated/server";
import { readSkillPageBySlug } from "./lib/skillPageRead";

// Keep detail reads independent of publishing and scanner initialization.
export const getBySlug = query({
  args: { slug: v.string(), ownerHandle: v.optional(v.string()) },
  handler: readSkillPageBySlug,
});
