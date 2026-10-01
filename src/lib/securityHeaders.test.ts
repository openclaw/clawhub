/* @vitest-environment node */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createContentSecurityPolicy, isLocalDevelopmentRequestUrl } from "./securityHeaders";
import {
  createThemeModeCookie,
  getThemeModeFromCookieHeader,
  THEME_MODE_COOKIE,
} from "./themeCookie";

const libDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(libDir, "../..");
const bootstrapPath = resolve(repoRoot, "public/theme-bootstrap.js");

function getGlobalVercelHeaders() {
  const vercelConfig = JSON.parse(readFileSync(resolve(repoRoot, "vercel.json"), "utf8"));
  return (
    vercelConfig.headers.find((entry: { source?: string }) => entry.source === "/(.*)")?.headers ??
    []
  );
}

function getCspHeader() {
  return createContentSecurityPolicy("test-nonce");
}

function getLocalDevelopmentCspHeader() {
  return createContentSecurityPolicy("test-nonce", { allowLocalDevelopment: true });
}

function getDirective(csp: string, name: string) {
  return (
    csp
      .split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith(`${name} `)) ?? ""
  );
}

function getDirectiveTokens(csp: string, name: string) {
  return getDirective(csp, name).split(/\s+/u);
}

describe("security headers", () => {
  it("blocks arbitrary inline scripts while allowing nonce-tagged framework scripts", () => {
    expect(getDirectiveTokens(getCspHeader(), "script-src")).toEqual([
      "script-src",
      "'self'",
      "'nonce-test-nonce'",
      "'unsafe-eval'",
    ]);
  });

  it("documents the current eval allowance without reopening inline script execution", () => {
    const scriptTokens = getDirectiveTokens(getCspHeader(), "script-src");

    expect(scriptTokens).toContain("'unsafe-eval'");
    expect(scriptTokens).not.toContain("'unsafe-inline'");
  });

  it("does not emit a second static Vercel CSP that would block dynamic nonces", () => {
    expect(
      getGlobalVercelHeaders().some(
        (header: { key?: string }) => header.key === "Content-Security-Policy",
      ),
    ).toBe(false);
  });

  it("keeps local Convex HTTP and WebSocket connections usable in local development", () => {
    const csp = getLocalDevelopmentCspHeader();
    const connectTokens = getDirectiveTokens(csp, "connect-src");

    expect(connectTokens).toEqual(["connect-src", "'self'", "https:", "wss:", "http:", "ws:"]);
    expect(csp).not.toContain("[::1]");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("keeps local docs auth form posts usable only in local development", () => {
    expect(getDirectiveTokens(getCspHeader(), "form-action")).toEqual([
      "form-action",
      "'self'",
      "https://clawhub.ai",
      "https://documentation.openclaw.ai",
      "https://docs.openclaw.ai",
    ]);

    expect(getDirectiveTokens(getLocalDevelopmentCspHeader(), "form-action")).toEqual([
      "form-action",
      "'self'",
      "https://clawhub.ai",
      "https://documentation.openclaw.ai",
      "https://docs.openclaw.ai",
      "http://localhost:*",
      "http://127.0.0.1:*",
    ]);
  });

  it("detects IPv4, IPv6, and localhost app origins as local development", () => {
    expect(isLocalDevelopmentRequestUrl("http://localhost:3000/")).toBe(true);
    expect(isLocalDevelopmentRequestUrl("http://127.0.0.1:3000/")).toBe(true);
    expect(isLocalDevelopmentRequestUrl("http://[::1]:3000/")).toBe(true);
    expect(isLocalDevelopmentRequestUrl("https://clawhub.ai/")).toBe(false);
  });

  it("does not bypass nonce CSP with a root-level theme bootstrap", () => {
    const rootRoute = readFileSync(resolve(repoRoot, "src/routes/__root.tsx"), "utf8");

    expect(rootRoute).not.toContain('src="/theme-bootstrap.js');
    expect(rootRoute).not.toContain("dangerouslySetInnerHTML");
    expect(existsSync(bootstrapPath)).toBe(false);
  });

  it("normalizes the SSR theme cookie to supported modes", () => {
    expect(getThemeModeFromCookieHeader(`${THEME_MODE_COOKIE}=dark`)).toBe("dark");
    expect(getThemeModeFromCookieHeader(`${THEME_MODE_COOKIE}=light`)).toBe("light");
    expect(getThemeModeFromCookieHeader(`${THEME_MODE_COOKIE}=system`)).toBe("system");
    expect(getThemeModeFromCookieHeader(`${THEME_MODE_COOKIE}=custom`)).toBe("system");
    expect(createThemeModeCookie("dark")).toContain(`${THEME_MODE_COOKIE}=dark`);
  });
});
