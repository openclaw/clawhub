import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

export type LoopbackAuthResult = {
  token: string
  registry?: string
  state?: string
}

export function buildCliAuthUrl(params: {
  siteUrl: string
  redirectUri: string
  label?: string
  state: string
}) {
  const url = new URL('/cli/auth', params.siteUrl)
  url.searchParams.set('redirect_uri', params.redirectUri)
  if (params.label) url.searchParams.set('label_b64', encodeBase64Url(params.label))
  url.searchParams.set('state', params.state)
  return url.toString()
}

export function isAllowedLoopbackRedirectUri(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'http:') return false
  const host = url.hostname.toLowerCase()
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1' && host !== '[::1]') {
    return false
  }
  return true
}

export async function startLoopbackAuthServer(params?: { timeoutMs?: number }) {
  const timeoutMs = params?.timeoutMs ?? 5 * 60_000
  const expectedState = generateState()

  let resolveToken: ((value: LoopbackAuthResult) => void) | null = null
  let rejectToken: ((error: Error) => void) | null = null
  const tokenPromise = new Promise<LoopbackAuthResult>((resolve, reject) => {
    resolveToken = resolve
    rejectToken = reject
  })

  const server = createServer((req, res) => {
    const method = req.method ?? 'GET'
    const url = req.url ?? '/'

    if (method === 'GET' && (url === '/' || url.startsWith('/callback'))) {
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(CALLBACK_HTML)
      return
    }

    if (method === 'POST' && url === '/token') {
      const chunks: Uint8Array[] = []
      req.on('data', (chunk) => chunks.push(chunk as Uint8Array))
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8')
          const parsed = JSON.parse(raw) as unknown
          if (!parsed || typeof parsed !== 'object') throw new Error('invalid payload')
          const token = (parsed as { token?: unknown }).token
          const registry = (parsed as { registry?: unknown }).registry
          const state = (parsed as { state?: unknown }).state
          if (typeof token !== 'string' || !token.trim()) throw new Error('token required')
          if (typeof state !== 'string' || state !== expectedState) {
            throw new Error('state mismatch')
          }
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true }))
          resolveToken?.({
            token: token.trim(),
            registry: typeof registry === 'string' ? registry : undefined,
            state,
          })
        } catch (error) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false }))
          const message = error instanceof Error ? error.message : 'invalid payload'
          rejectToken?.(new Error(message))
        } finally {
          server.close()
        }
      })
      return
    }

    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('Not found')
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo | null
  if (!address) {
    server.close()
    throw new Error('Failed to bind loopback server')
  }
  const redirectUri = `http://127.0.0.1:${address.port}/callback`

  const timeout = setTimeout(() => {
    server.close()
    rejectToken?.(new Error('Timed out waiting for browser login'))
  }, timeoutMs)
  tokenPromise.finally(() => clearTimeout(timeout)).catch(() => {})

  return {
    redirectUri,
    state: expectedState,
    waitForResult: () => tokenPromise,
    close: () => server.close(),
  }
}

const CALLBACK_HTML = `<!doctype html>
<html lang="en">
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ClawHub CLI Login</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; padding: 24px; }
    .card { max-width: 560px; margin: 40px auto; padding: 18px 16px; border: 1px solid rgba(127,127,127,.35); border-radius: 12px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  </style>
  <body>
    <div class="card">
      <h1 style="margin: 0 0 10px; font-size: 18px;">Completing login…</h1>
      <p id="status" style="margin: 0; opacity: .8;">Waiting for token.</p>
    </div>
    <script>
      const statusEl = document.getElementById('status')
      const params = new URLSearchParams(location.hash.replace(/^#/, ''))
      const token = params.get('token')
      const registry = params.get('registry')
      const state = params.get('state')
      if (!token) {
        statusEl.textContent = 'Missing token in URL. You can close this tab and try again.'
      } else if (!state) {
        statusEl.textContent = 'Missing state in URL. You can close this tab and try again.'
      } else {
        fetch('/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, registry, state }),
        }).then(() => {
          statusEl.textContent = 'Logged in. You can close this tab.'
          setTimeout(() => window.close(), 250)
        }).catch(() => {
          statusEl.textContent = 'Failed to send token to CLI. You can close this tab and try again.'
        })
      }
    </script>
  </body>
</html>`

function encodeBase64Url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function generateState() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex')
}
