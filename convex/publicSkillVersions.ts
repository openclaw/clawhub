import { ConvexError, v } from "convex/values";
import { internalQuery } from "./_generated/server";
import {
  readPublicSkillVersion,
  readPublicSkillVersionSelections,
} from "./lib/skills/publicVersions";

// Keep HTTP publication rechecks independent of the publishing module's initialization.
// Publication selection is separate from each route's parent authorization and
// scan policy. These internal snapshots must never be serialized wholesale.
export const getPublicVersionSelectionInternal = internalQuery({
  args: {
    skillId: v.id("skills"),
    versionId: v.optional(v.id("skillVersions")),
    version: v.optional(v.string()),
    tag: v.optional(v.string()),
  },
  handler: readPublicSkillVersion,
});

export const getPublicVersionSelectionsInternal = internalQuery({
  args: {
    selections: v.array(v.object({ skillId: v.id("skills"), versionId: v.id("skillVersions") })),
  },
  handler: async (ctx, args) => {
    if (args.selections.length > 250)
      throw new ConvexError("At most 250 version selections are allowed.");
    return readPublicSkillVersionSelections(ctx, args.selections);
  },
});
