import { defineEventHandler, getRequestHeader, setHeader } from 'h3'

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
].join('; ')

export default defineEventHandler((event) => {
  const accept = getRequestHeader(event, 'accept') ?? ''
  const isHtml = accept.includes('text/html')

  if (isHtml && process.env.NODE_ENV === 'production') {
    setHeader(event, 'Content-Security-Policy', CSP)
  }

  setHeader(event, 'Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  setHeader(event, 'Referrer-Policy', 'strict-origin-when-cross-origin')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'X-Frame-Options', 'DENY')
})
