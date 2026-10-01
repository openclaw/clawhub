const CSP_FORM_ACTION_ORIGINS = [
  "'self'",
  "https://clawhub.ai",
  "https://documentation.openclaw.ai",
  "https://docs.openclaw.ai",
];

const LOCAL_DEVELOPMENT_CONNECT_SOURCES = [
  // Browser CSP parsers reject bracketed IPv6 host sources like http://[::1]:*.
  "http:",
  "ws:",
];

const LOCAL_DEVELOPMENT_FORM_ACTION_ORIGINS = ["http://localhost:*", "http://127.0.0.1:*"];

type ContentSecurityPolicyOptions = {
  allowLocalDevelopment?: boolean;
};

export function isLocalDevelopmentRequestUrl(requestUrl: string) {
  const { hostname } = new URL(requestUrl);
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

export function createContentSecurityPolicy(
  scriptNonce: string,
  options: ContentSecurityPolicyOptions = {},
) {
  const connectSources = ["'self'", "https:", "wss:"];
  const formActionOrigins = [...CSP_FORM_ACTION_ORIGINS];
  if (options.allowLocalDevelopment) {
    connectSources.push(...LOCAL_DEVELOPMENT_CONNECT_SOURCES);
    formActionOrigins.push(...LOCAL_DEVELOPMENT_FORM_ACTION_ORIGINS);
  }

  return [
    "default-src 'self'",
    // Arktype currently ships in public route bundles through shared schema helpers and probes
    // eval support with Function(). Keep inline scripts nonce-gated, but allow eval until those
    // helpers are split out of the browser bundle.
    `script-src 'self' 'nonce-${scriptNonce}' 'unsafe-eval'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    `form-action ${formActionOrigins.join(" ")}`,
    ...(options.allowLocalDevelopment ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
