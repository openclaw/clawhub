import { parseArk, WellKnownConfigSchema } from 'clawdhub-schema'

export async function discoverRegistryFromSite(siteUrl: string) {
  const url = new URL('/.well-known/clawdhub.json', siteUrl)
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) return null
  const raw = (await response.json()) as unknown
  const parsed = parseArk(WellKnownConfigSchema, raw, 'WellKnown config')
  const apiBase = 'apiBase' in parsed ? parsed.apiBase : parsed.registry
  if (!apiBase) return null
  return {
    apiBase,
    authBase: parsed.authBase,
    minCliVersion: parsed.minCliVersion,
  }
}
