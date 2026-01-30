import { defineEventHandler, getHeader, setResponseHeader, setResponseStatus } from 'h3'

type MaintenancePayload = {
  enabled?: boolean
  message?: string | null
}

type CachedMaintenance = {
  checkedAt: number
  enabled: boolean
  message?: string | null
}

const CACHE_TTL_MS = 5000
let cached: CachedMaintenance | null = null

async function fetchMaintenanceStatus(): Promise<CachedMaintenance | null> {
  const baseUrl = process.env.VITE_CONVEX_SITE_URL ?? process.env.CONVEX_SITE_URL
  if (!baseUrl) return null

  try {
    const url = new URL('/maintenance', baseUrl)
    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null
    const payload = (await response.json()) as MaintenancePayload
    return {
      checkedAt: Date.now(),
      enabled: Boolean(payload.enabled),
      message: payload.message ?? null,
    }
  } catch {
    return null
  }
}

export default defineEventHandler(async (event) => {
  if (event.path === '/maintenance') return

  const now = Date.now()
  if (!cached || now - cached.checkedAt > CACHE_TTL_MS) {
    cached = await fetchMaintenanceStatus()
  }

  if (!cached?.enabled) return

  const accept = getHeader(event, 'accept') ?? ''
  const message = cached.message || 'Clawhub is temporarily unavailable while we run maintenance.'
  setResponseStatus(event, 503)
  setResponseHeader(event, 'retry-after', '300')

  if (accept.includes('application/json')) {
    return { error: 'maintenance', message }
  }

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Maintenance</title>
  </head>
  <body style="font-family: system-ui, sans-serif; padding: 2rem;">
    <h1>We’ll be right back.</h1>
    <p>${message}</p>
  </body>
</html>`
})
