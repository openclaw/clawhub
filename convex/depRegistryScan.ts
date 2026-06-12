import { v } from "convex/values";
import { internalAction } from "./_generated/server";

export async function checkDependencyRegistriesHandler(): Promise<null> {
  return null;
}

export const checkDependencyRegistries = internalAction({
  args: { versionId: v.id("skillVersions") },
  handler: checkDependencyRegistriesHandler,
});
