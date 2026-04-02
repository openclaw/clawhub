import { query } from "./functions";

function normalizeEnv(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export const getDeploymentInfo = query({
  args: {},
  handler: async () => ({
    appBuildSha: normalizeEnv(process.env.APP_BUILD_SHA),
    deployedAt: normalizeEnv(process.env.APP_DEPLOYED_AT),
  }),
});
