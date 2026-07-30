import { getClawHubRolloutCapabilities, type ClawHubRolloutEnvironment } from "clawhub-schema";
import type { QueryCtx } from "./_generated/server";
import { internalQuery, query } from "./functions";

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
  const mirrorPublicActive = Boolean(
    runtime.skillsSh.runtimeEnabled && control?.mirrorPublicVisibilityEnabled,
  );
  return {
    environment: runtime.environment,
    catalogDiscovery: {
      apiVersion: 1,
      // This advertises the canonical API contract, not row availability.
      // Clients must use its unavailable/empty states instead of falling back
      // to legacy seven-day or lifetime popularity under a 24-hour label.
      canonicalTrendingEnabled: true,
    },
    skillsSh: {
      mode: runtime.skillsSh.mode,
      runtimeEnabled: runtime.skillsSh.runtimeEnabled,
      discoveryEnabled: mirrorPublicActive || (catalogActive && Boolean(control?.discoveryEnabled)),
      writesEnabled: catalogActive && Boolean(control?.writesEnabled),
      publicCatalogEnabled: mirrorPublicActive,
      scanPlanningEnabled: catalogActive && Boolean(control?.scanPlanningEnabled),
      scanAdmissionEnabled: catalogActive && Boolean(control?.scanAdmissionEnabled),
    },
    githubSkillSync: {
      mode: runtime.githubSkillSync.mode,
      selfServiceEnabled: runtime.githubSkillSync.runtimeEnabled,
    },
  };
}

export async function getSkillsShPublicCatalogEnabledHandler(
  ctx: Pick<QueryCtx, "db">,
  env: ClawHubRolloutEnvironment = process.env,
) {
  return (await getPublicCapabilitiesHandler(ctx, env)).skillsSh.publicCatalogEnabled;
}

export const getPublicCapabilitiesInternal = internalQuery({
  args: {},
  handler: async (ctx) => await getPublicCapabilitiesHandler(ctx),
});

export const getPublicCapabilities = query({
  args: {},
  handler: async (ctx) => await getPublicCapabilitiesHandler(ctx),
});
