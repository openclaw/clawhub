import type { ArkValidator } from 'clawdhub-schema'
import { ApiRoutes, parseArk } from 'clawdhub-schema'
import pRetry, { AbortError } from 'p-retry'

type RequestArgs =
  | { method: 'GET' | 'POST'; path: string; token?: string; body?: unknown }
  | { method: 'GET' | 'POST'; url: string; token?: string; body?: unknown }

export async function apiRequest<T>(registry: string, args: RequestArgs): Promise<T>
export async function apiRequest<T>(
  registry: string,
  args: RequestArgs,
  schema: ArkValidator<T>,
): Promise<T>
export async function apiRequest<T>(
  registry: string,
  args: RequestArgs,
  schema?: ArkValidator<T>,
): Promise<T> {
  const url = 'url' in args ? args.url : new URL(args.path, registry).toString()
  const json = await pRetry(
    async () => {
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (args.token) headers.Authorization = `Bearer ${args.token}`
      let body: string | undefined
      if (args.method === 'POST') {
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify(args.body ?? {})
      }
      const response = await fetch(url, { method: args.method, headers, body })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        const message = text || `HTTP ${response.status}`
        if (response.status === 429 || response.status >= 500) {
          throw new Error(message)
        }
        throw new AbortError(message)
      }
      return (await response.json()) as unknown
    },
    { retries: 2 },
  )
  if (schema) return parseArk(schema, json, 'API response')
  return json as T
}

export async function downloadZip(registry: string, args: { slug: string; version?: string }) {
  const url = new URL(ApiRoutes.download, registry)
  url.searchParams.set('slug', args.slug)
  if (args.version) url.searchParams.set('version', args.version)
  return pRetry(
    async () => {
      const response = await fetch(url.toString(), { method: 'GET' })
      if (!response.ok) {
        const message = (await response.text().catch(() => '')) || `HTTP ${response.status}`
        if (response.status === 429 || response.status >= 500) {
          throw new Error(message)
        }
        throw new AbortError(message)
      }
      return new Uint8Array(await response.arrayBuffer())
    },
    { retries: 2 },
  )
}
