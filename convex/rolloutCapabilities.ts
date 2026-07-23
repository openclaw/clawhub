import { getClawHubRolloutCapabilities, type ClawHubRolloutEnvironment } from "clawhub-schema";
import type { QueryCtx } from "./_generated/server";
import { query } from "./functions";

const CONTROL_KEY = "global";

export async function getPublicCapabilitiesHandler(
  ctx: Pick<QueryCtx, "db">,
  env: ClawHubRolloutEnvironment = process.env,
) {
  const runtime = getClawHubRolloutCapabilities(env);
  const control = runtime.skillsSh.runtimeEnabled
    ? await ctx.db
        .query("skillsShCatalogControls")
        .withIndex("by_key", (q) => q.eq("key", CONTROL_KEY))
        .unique()
    : null;
  const catalogActive = Boolean(
    runtime.skillsSh.runtimeEnabled && control && control.mode !== "off" && !control.paused,
  );
  return {
    environment: runtime.environment,
    skillsSh: {
      mode: runtime.skillsSh.mode,
      runtimeEnabled: runtime.skillsSh.runtimeEnabled,
      discoveryEnabled: catalogActive && Boolean(control?.discoveryEnabled),
      writesEnabled: catalogActive && Boolean(control?.writesEnabled),
      publicCatalogEnabled:
        catalogActive &&
        Boolean(control?.discoveryEnabled) &&
        Boolean(control?.publicVisibilityEnabled),
      scanPlanningEnabled: catalogActive && Boolean(control?.scanPlanningEnabled),
      scanAdmissionEnabled: catalogActive && Boolean(control?.scanAdmissionEnabled),
    },
    githubSkillSync: {
      mode: runtime.githubSkillSync.mode,
      selfServiceEnabled: runtime.githubSkillSync.runtimeEnabled,
    },
  };
}

export const getPublicCapabilities = query({
  args: {},
  handler: async (ctx) => await getPublicCapabilitiesHandler(ctx),
});
