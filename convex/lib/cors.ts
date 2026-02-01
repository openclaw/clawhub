/**
 * CORS headers for public API endpoints.
 *
 * ClawHub is a public skill registry. Browser-based clients (like Cove WebUI)
 * need CORS headers to fetch skills directly from the API.
 */

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400', // 24 hours
} as const

/**
 * Handle CORS preflight (OPTIONS) requests.
 */
export function corsPreflightResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  })
}
