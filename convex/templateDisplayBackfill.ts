import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import {
  templateDisplayBindingValidator,
  templateDisplayDataValidator,
} from "./lib/templateDisplayData";
import {
  templateDisplayBinding,
  writeTemplateDisplaySnapshot,
} from "./lib/templateDisplaySnapshot";

type BackfillResult =
  | "stored"
  | "already-present"
  | "unavailable"
  | "unsupported"
  | "binding-changed"
  | "oversize";
// Operator-only, explicit release AND digest. One call reads at most one bounded artifact;
// no public lifecycle hook or read endpoint schedules a write or a whole-registry migration.
export const one = internalAction({
  args: { name: v.string(), version: v.string(), sha256: v.string() },
  handler: async (ctx, { name, version, sha256 }): Promise<BackfillResult> => {
    if (!name || !version || version.length > 256 || !/^[a-f0-9]{64}$/.test(sha256))
      return "unavailable";
    const selected = await ctx.runQuery(internal.packages.getPublicTemplateInventoryInternal, {
      name,
      version,
    });
    if (!selected || selected.blocked) return "unavailable";
    const binding = templateDisplayBinding(selected.package.name, selected.release);
    if (!binding) return "unsupported";
    if (binding.sha256 !== sha256 || selected.projection === "invalid") return "binding-changed";
    if (selected.projection) return "already-present";
    const { readVerifiedTemplateDisplayArchive } = await import("./lib/templateDisplayArchive");
    const parsed = await readVerifiedTemplateDisplayArchive(ctx.storage, binding);
    if (!parsed.ok) return parsed.status === 413 ? "oversize" : "unsupported";
    return (await ctx.runMutation(internal.templateDisplayBackfill.record, {
      releaseId: selected.release._id,
      binding,
      data: parsed.data,
    }))
      ? "stored"
      : "binding-changed";
  },
});
export const record = internalMutation({
  args: {
    releaseId: v.id("packageReleases"),
    binding: templateDisplayBindingValidator,
    data: templateDisplayDataValidator,
  },
  handler: (ctx, { releaseId, binding, data }) =>
    writeTemplateDisplaySnapshot(ctx, releaseId, binding, data),
});
