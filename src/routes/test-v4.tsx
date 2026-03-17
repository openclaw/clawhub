import { ConvexHttpClient } from 'convex/browser'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { ClientOnly } from '../components/ClientOnly'

export const Route = createFileRoute('/test-v4')({
  component: () => (
    <ClientOnly fallback={<div style={{ padding: 24 }}>Loading...</div>}>
      <TestV4 />
    </ClientOnly>
  ),
})

const DEFAULT_URL = import.meta.env.VITE_CONVEX_URL ?? ''

type SortKey = 'newest' | 'updated' | 'downloads' | 'installs' | 'stars' | 'name'

function TestV4() {
  const [url, setUrl] = useState(DEFAULT_URL)
  const [sort, setSort] = useState<SortKey>('downloads')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [numItems, setNumItems] = useState(5)
  const [nonSuspiciousOnly, setNonSuspiciousOnly] = useState(true)
  const [highlightedOnly, setHighlightedOnly] = useState(false)
  const [cursor, setCursor] = useState<string | null>(null)

  const [results, setResults] = useState<unknown[]>([])
  const [response, setResponse] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<Array<{ label: string; response: unknown; error?: string }>>([])

  const fetchPage = useCallback(async (cursorOverride?: string | null) => {
    console.log('[test-v4] fetchPage called, cursorOverride:', cursorOverride)
    setLoading(true)
    setError(null)
    const c = cursorOverride !== undefined ? cursorOverride : cursor
    const label = `sort=${sort} dir=${dir} n=${numItems} cursor=${c ? c.slice(0, 30) + '...' : 'null'}`
    const queryArgs = {
      cursor: c ?? undefined,
      numItems,
      sort,
      dir,
      nonSuspiciousOnly,
      highlightedOnly,
    }
    console.log('[test-v4] calling V4 with args:', JSON.stringify(queryArgs))
    try {
      const client = new ConvexHttpClient(url)
      const result = await client.query(api.skills.listPublicPageV4, queryArgs)
      console.log('[test-v4] result:', JSON.stringify(result).slice(0, 500))
      setResponse(result)
      setResults((prev) => c ? [...prev, ...result.page] : result.page)
      setCursor(result.nextCursor)
      setHistory((prev) => [...prev, { label, response: result }])
    } catch (err) {
      console.error('[test-v4] error:', err)
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setHistory((prev) => [...prev, { label, error: msg, response: null }])
    } finally {
      setLoading(false)
    }
  }, [url, sort, dir, numItems, nonSuspiciousOnly, highlightedOnly, cursor])

  const reset = () => {
    setCursor(null)
    setResults([])
    setResponse(null)
    setError(null)
  }

  return (
    <main style={{ padding: 24, fontFamily: 'monospace', maxWidth: 900, margin: '0 auto' }}>
      <h1>V4 Pagination Test</h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        <label>
          Convex URL:{' '}
          <input value={url} onChange={(e) => setUrl(e.target.value)} style={{ width: 400 }} />
        </label>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label>
            Sort:{' '}
            <select value={sort} onChange={(e) => { setSort(e.target.value as SortKey); reset() }}>
              {['newest', 'updated', 'downloads', 'installs', 'stars', 'name'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Dir:{' '}
            <select value={dir} onChange={(e) => { setDir(e.target.value as 'asc' | 'desc'); reset() }}>
              <option value="desc">desc</option>
              <option value="asc">asc</option>
            </select>
          </label>
          <label>
            Page size:{' '}
            <input type="number" value={numItems} onChange={(e) => { setNumItems(Number(e.target.value)); reset() }} style={{ width: 60 }} />
          </label>
          <label>
            <input type="checkbox" checked={nonSuspiciousOnly} onChange={(e) => { setNonSuspiciousOnly(e.target.checked); reset() }} />{' '}
            nonSuspiciousOnly
          </label>
          <label>
            <input type="checkbox" checked={highlightedOnly} onChange={(e) => { setHighlightedOnly(e.target.checked); reset() }} />{' '}
            highlightedOnly
          </label>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => { reset(); void fetchPage(null) }} disabled={loading}>
          Fetch first page
        </button>
        <button onClick={() => void fetchPage()} disabled={loading || !cursor}>
          Load more (cursor: {cursor ? cursor.slice(0, 25) + '...' : 'null'})
        </button>
        <button onClick={reset}>Reset</button>
      </div>

      {loading && <div style={{ color: '#888' }}>Loading...</div>}
      {error && <div style={{ color: 'red', whiteSpace: 'pre-wrap', marginBottom: 8 }}>Error: {error}</div>}

      {response !== null && (
        <details open style={{ marginBottom: 16 }}>
          <summary>Raw response ({String((response as { page: unknown[] }).page?.length)} items, hasMore: {String((response as { hasMore: boolean }).hasMore)})</summary>
          <pre style={{ fontSize: 11, maxHeight: 300, overflow: 'auto', background: '#f5f5f5', padding: 8 }}>
            {JSON.stringify(response, null, 2)}
          </pre>
        </details>
      )}

      <h2>Accumulated results ({results.length})</h2>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #333', textAlign: 'left' }}>
            <th style={{ padding: 4 }}>#</th>
            <th style={{ padding: 4 }}>slug</th>
            <th style={{ padding: 4 }}>displayName</th>
            <th style={{ padding: 4 }}>downloads</th>
            <th style={{ padding: 4 }}>stars</th>
            <th style={{ padding: 4 }}>installs</th>
            <th style={{ padding: 4 }}>owner</th>
          </tr>
        </thead>
        <tbody>
          {results.map((item: unknown, i: number) => {
            const r = item as { skill: { slug: string; displayName: string; stats: { downloads: number; stars: number; installsAllTime?: number } }; ownerHandle?: string | null }
            return (
              <tr key={i} style={{ borderBottom: '1px solid #ddd' }}>
                <td style={{ padding: 4 }}>{i + 1}</td>
                <td style={{ padding: 4 }}>{r.skill.slug}</td>
                <td style={{ padding: 4 }}>{r.skill.displayName}</td>
                <td style={{ padding: 4 }}>{r.skill.stats.downloads}</td>
                <td style={{ padding: 4 }}>{r.skill.stats.stars}</td>
                <td style={{ padding: 4 }}>{r.skill.stats.installsAllTime ?? 0}</td>
                <td style={{ padding: 4 }}>{r.ownerHandle ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {history.length > 0 && (
        <>
          <h2>Request history</h2>
          {history.map((h, i) => (
            <div key={i} style={{ fontSize: 11, padding: 4, borderBottom: '1px solid #eee', color: h.error ? 'red' : '#333' }}>
              [{i}] {h.label} {h.error ? `ERROR: ${h.error}` : `→ ${String((h.response as { page: unknown[] })?.page?.length)} items`}
            </div>
          ))}
        </>
      )}
    </main>
  )
}
