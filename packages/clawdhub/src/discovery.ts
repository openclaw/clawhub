import { parseArk, WellKnownConfigSchema } from './schema/index.js'

export async function discoverRegistryFromSite(siteUrl: string) {
  const paths = ['/.well-known/clawhub.json', '/.well-known/clawdhub.json']
  for (const path of paths) {
    const url = new URL(path, siteUrl)
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) continue
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
  return null
}
