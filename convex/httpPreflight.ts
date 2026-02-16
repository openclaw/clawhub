import { httpAction } from './_generated/server'
import { corsHeaders, mergeHeaders } from './lib/httpHeaders'

function getHeader(request: Request, name: string) {
  return request.headers.get(name) ?? request.headers.get(name.toLowerCase())
}

export function buildPreflightHeaders(request: Request) {
  const requestedHeaders = getHeader(request, 'Access-Control-Request-Headers')?.trim() || null
  const requestedMethod = getHeader(request, 'Access-Control-Request-Method')?.trim() || null

  const vary = [
    ...(requestedMethod ? ['Access-Control-Request-Method'] : []),
    ...(requestedHeaders ? ['Access-Control-Request-Headers'] : []),
  ].join(', ')

  return mergeHeaders(
    corsHeaders(),
    {
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD',
      'Access-Control-Allow-Headers':
        requestedHeaders ?? 'Content-Type, Authorization, Digest, X-Clawhub-Version',
      'Access-Control-Max-Age': '86400',
      ...(vary ? { Vary: vary } : {}),
    },
  )
}

export const preflightHandler = httpAction(async (_ctx, request) => {
  // No cookies/credentials supported; allow any origin for simple browser access.
  // If we ever add cookie auth, this must switch to reflecting origin + Allow-Credentials.
  return new Response(null, {
    status: 204,
    headers: buildPreflightHeaders(request),
  })
})

