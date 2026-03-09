import { query } from './_generated/server'

function normalizeEnv(value: string | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function readEnv(key: string): string | undefined {
  // Convex functions don't always run in a Node.js environment.
  // Accessing `process.env` directly can throw `ReferenceError: process is not defined`.
  const env = (globalThis as any)?.process?.env as Record<string, string | undefined> | undefined
  return env?.[key]
}

export const getDeploymentInfo = query({
  args: {},
  handler: async () => ({
    appBuildSha: normalizeEnv(readEnv('APP_BUILD_SHA')),
    deployedAt: normalizeEnv(readEnv('APP_DEPLOYED_AT')),
  }),
})
