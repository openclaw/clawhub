import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action } from "./_generated/server";
import { canReadSkillVersionFiles } from "./lib/skillFileReadAccess";
import { fetchText } from "./lib/storageText";

type ReadmeResult = { path: string; text: string; sourceBaseUrl?: string };

// Public reads do not need the publishing/scanning module on their startup path.
export const getReadme: ReturnType<typeof action> = action({
  args: { versionId: v.id("skillVersions") },
  handler: async (ctx, args): Promise<ReadmeResult> => {
    const version = (await ctx.runQuery(internal.skillFileReads.getVersionByIdInternal, {
      versionId: args.versionId,
    })) as Doc<"skillVersions"> | null;
    if (!version) throw new ConvexError("Version not found");
    if (!(await canReadSkillVersionFiles(ctx, version))) {
      throw new ConvexError("Version not available");
    }
    const readmeFile = version.files.find(
      (file) => file.path.toLowerCase() === "skill.md" || file.path.toLowerCase() === "skills.md",
    );
    if (!readmeFile) throw new ConvexError("SKILL.md not found");
    const text = await fetchText(ctx, readmeFile.storageId);
    return { path: readmeFile.path, text };
  },
});
