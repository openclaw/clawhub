/* @vitest-environment node */

import { describe, expect, it } from 'vitest'
import {
  buildCliAuthUrl,
  isAllowedLoopbackRedirectUri,
  startLoopbackAuthServer,
} from './browserAuth'

describe('browserAuth', () => {
  it('builds auth url', () => {
    const url = buildCliAuthUrl({
      siteUrl: 'https://example.com',
      redirectUri: 'http://127.0.0.1:1234/callback',
      label: 'CLI token',
      state: 'state123',
    })
    expect(url).toContain('https://example.com/cli/auth?')
    expect(url).toContain('redirect_uri=')
    expect(url).toContain('label_b64=')
    expect(url).toContain('state=')
  })

  it('builds auth url without label', () => {
    const url = buildCliAuthUrl({
      siteUrl: 'https://example.com',
      redirectUri: 'http://127.0.0.1:1234/callback',
      state: 'state123',
    })
    expect(url).toContain('https://example.com/cli/auth?')
    expect(url).not.toContain('label_b64=')
  })

  it('accepts only loopback http redirect uris', () => {
    expect(isAllowedLoopbackRedirectUri('http://127.0.0.1:1234/callback')).toBe(true)
    expect(isAllowedLoopbackRedirectUri('http://localhost:1234/callback')).toBe(true)
    expect(isAllowedLoopbackRedirectUri('http://[::1]:1234/callback')).toBe(true)
    expect(isAllowedLoopbackRedirectUri('https://127.0.0.1:1234/callback')).toBe(false)
    expect(isAllowedLoopbackRedirectUri('http://evil.com/callback')).toBe(false)
    expect(isAllowedLoopbackRedirectUri('not a url')).toBe(false)
  })

  it('receives token via loopback server', async () => {
    const server = await startLoopbackAuthServer({ timeoutMs: 2000 })
    const payload = {
      token: 'clh_test',
      registry: 'https://example.convex.site',
      state: server.state,
    }
    await fetch(server.redirectUri.replace('/callback', '/token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    await expect(server.waitForResult()).resolves.toEqual(payload)
  })

  it('serves callback html', async () => {
    const server = await startLoopbackAuthServer({ timeoutMs: 2000 })
    const response = await fetch(server.redirectUri)
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain('ClawHub CLI Login')
    server.close()
  })

  it('returns 404 for unknown routes', async () => {
    const server = await startLoopbackAuthServer({ timeoutMs: 2000 })
    const response = await fetch(server.redirectUri.replace('/callback', '/nope'))
    expect(response.status).toBe(404)
    server.close()
  })

  it('rejects invalid json payloads', async () => {
    const server = await startLoopbackAuthServer({ timeoutMs: 2000 })
    const tokenUrl = server.redirectUri.replace('/callback', '/token')
    const response = await fetch(tokenUrl, { method: 'POST', body: '{' })
    expect(response.status).toBe(400)
    await expect(server.waitForResult()).rejects.toThrow()
  })

  it('rejects state mismatches', async () => {
    const server = await startLoopbackAuthServer({ timeoutMs: 2000 })
    await fetch(server.redirectUri.replace('/callback', '/token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'clh_test', registry: 'https://example.com', state: 'nope' }),
    })
    await expect(server.waitForResult()).rejects.toThrow(/state mismatch/i)
  })

  it('times out waiting for login', async () => {
    const server = await startLoopbackAuthServer({ timeoutMs: 25 })
    await expect(server.waitForResult()).rejects.toThrow(/timed out waiting for browser login/i)
  })
})
