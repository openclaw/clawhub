import { defineEventHandler, getRequestURL, proxyRequest, type H3Event } from "h3";
import { convexDeploymentName, resolveConvexSiteUrl } from "../src/lib/convexDeploymentUrl";

type ProxyEnv = {
  CONVEX_URL?: string;
  VERCEL_ENV?: string;
  VERCEL_TARGET_ENV?: string;
  VITE_CLAWHUB_DEPLOY_ENV?: string;
  VITE_CONVEX_SITE_URL?: string;
  VITE_CONVEX_URL?: string;
};

const BUNDLED_PROXY_ENV: ProxyEnv = {
  VITE_CLAWHUB_DEPLOY_ENV: import.meta.env.VITE_CLAWHUB_DEPLOY_ENV,
  VITE_CONVEX_SITE_URL: import.meta.env.VITE_CONVEX_SITE_URL,
  VITE_CONVEX_URL: import.meta.env.VITE_CONVEX_URL,
};

export function resolveConvexProxyEnv(
  runtimeEnv: ProxyEnv,
  bundledEnv: ProxyEnv = BUNDLED_PROXY_ENV,
): ProxyEnv {
  return {
    ...runtimeEnv,
    ...(bundledEnv.VITE_CLAWHUB_DEPLOY_ENV
      ? { VITE_CLAWHUB_DEPLOY_ENV: bundledEnv.VITE_CLAWHUB_DEPLOY_ENV }
      : {}),
    ...(bundledEnv.VITE_CONVEX_SITE_URL
      ? { VITE_CONVEX_SITE_URL: bundledEnv.VITE_CONVEX_SITE_URL }
      : {}),
    ...(bundledEnv.VITE_CONVEX_URL ? { VITE_CONVEX_URL: bundledEnv.VITE_CONVEX_URL } : {}),
  };
}

function isPreviewFrontend(env: ProxyEnv) {
  const targetEnvironment =
    env.VITE_CLAWHUB_DEPLOY_ENV?.trim() || env.VERCEL_TARGET_ENV?.trim() || env.VERCEL_ENV?.trim();
  return targetEnvironment === "preview";
}

function isTestFrontend(env: ProxyEnv) {
  const targetEnvironment =
    env.VITE_CLAWHUB_DEPLOY_ENV?.trim() || env.VERCEL_TARGET_ENV?.trim() || env.VERCEL_ENV?.trim();
  return targetEnvironment === "test";
}

export function isConvexProxyMethodAllowed(method: string, env: ProxyEnv) {
  if (!isPreviewFrontend(env)) return true;
  return method === "GET" || method === "HEAD";
}

export function buildConvexProxyTarget(pathAndQuery: string, env: ProxyEnv) {
  const requestUrl = new URL(pathAndQuery, "https://clawhub.invalid");
  const targetPath = requestUrl.pathname.startsWith("/v1/feeds/")
    ? `/api${requestUrl.pathname}`
    : requestUrl.pathname;
  const targetUrl = new URL(targetPath, resolveConvexSiteUrl(env));
  targetUrl.search = requestUrl.search;
  return targetUrl.toString();
}

export async function proxyConvexRequest(
  event: H3Event,
  env: ProxyEnv = resolveConvexProxyEnv(process.env),
): Promise<Response> {
  if (!isConvexProxyMethodAllowed(event.req.method, env)) {
    return new Response("Disposable previews are read-only.", {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  const requestUrl = getRequestURL(event);
  const target = buildConvexProxyTarget(`${requestUrl.pathname}${requestUrl.search}`, env);
  const proxied = await proxyRequest(event, target);
  // H3's HTTPResponse is not guaranteed to share Nitro's bundled class identity.
  // Normalize it before crossing that boundary or Nitro can stringify the wrapper.
  const response = new Response(proxied.body, {
    status: proxied.status,
    statusText: proxied.statusText,
    headers: proxied.headers,
  });
  if (isPreviewFrontend(env) || isTestFrontend(env)) {
    const deployment = convexDeploymentName(target);
    if (deployment) {
      response.headers.set(
        isTestFrontend(env) ? "X-ClawHub-Test-Backend" : "X-ClawHub-Preview-Backend",
        deployment,
      );
    }
  }
  return response;
}

export default defineEventHandler((event) => proxyConvexRequest(event));
