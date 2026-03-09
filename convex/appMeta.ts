import { query } from './_generated/server'

function normalizeEnv(value: string | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

export const getDeploymentInfo = query({
  args: {},
  handler: async () => {
    try {
      return {
        appBuildSha: normalizeEnv(process.env.APP_BUILD_SHA),
        deployedAt: normalizeEnv(process.env.APP_DEPLOYED_AT),
      }
    } catch {
      return { appBuildSha: null, deployedAt: null }
    }
  },
})
