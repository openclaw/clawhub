"use node";

import { createPrivateKey, createSign } from "node:crypto";

const GITHUB_API = "https://api.github.com";

export function isGitHubAppConfigured() {
  return Boolean(
    process.env.GITHUB_APP_ID &&
      process.env.GITHUB_APP_PRIVATE_KEY &&
      process.env.GITHUB_APP_INSTALLATION_ID,
  );
}

export async function createInstallationToken(userAgent: string) {
  const appId = process.env.GITHUB_APP_ID;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
  if (!appId || !installationId) {
    throw new Error("GitHub App credentials missing");
  }
  const jwt = createAppJwt(appId);
  const response = await fetch(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: buildGitHubHeaders(jwt, userAgent, true),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`GitHub App token failed: ${message}`);
  }
  const payload = (await response.json()) as { token?: string };
  if (!payload.token) throw new Error("GitHub App token missing");
  return payload.token;
}

function createAppJwt(appId: string) {
  const privateKey = loadPrivateKey();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: now - 60, exp: now + 9 * 60, iss: appId };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signingInput);
  sign.end();
  const signature = sign.sign(privateKey);
  return `${signingInput}.${base64Url(signature)}`;
}

function loadPrivateKey() {
  const raw = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!raw) throw new Error("GITHUB_APP_PRIVATE_KEY is not configured");
  const normalized = raw.replace(/\\n/g, "\n");
  return createPrivateKey(normalized);
}

export function buildGitHubHeaders(token: string, userAgent: string, isAppJwt = false) {
  return {
    Authorization: `${isAppJwt ? "Bearer" : "token"} ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": userAgent,
  };
}

function base64Url(input: string | Uint8Array) {
  return Buffer.from(input).toString("base64url");
}
