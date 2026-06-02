/* @vitest-environment node */

import { mockEvent } from "h3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const handler = (await import("../routes/dev-auth/secret")).default;

const originalEnv = {
  CONVEX_DEPLOYMENT: process.env.CONVEX_DEPLOYMENT,
  DEV_AUTH_CONVEX_DEPLOYMENT: process.env.DEV_AUTH_CONVEX_DEPLOYMENT,
  DEV_AUTH_ENABLED: process.env.DEV_AUTH_ENABLED,
  DEV_AUTH_SECRET: process.env.DEV_AUTH_SECRET,
};

function restoreEnv(name: keyof typeof originalEnv) {
  const value = originalEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function createEvent(
  url = "http://localhost:3001/dev-auth/secret",
  headers: HeadersInit = {},
  clientAddress = "127.0.0.1",
) {
  const event = mockEvent(url, {
    headers: {
      host: new URL(url).host,
      ...headers,
    },
  });
  event.context.clientAddress = clientAddress;
  return event;
}

async function runSecretRoute(event: ReturnType<typeof createEvent>) {
  const response = await handler(event);
  if (!(response instanceof Response)) {
    throw new Error("Expected dev-auth secret route to return a Response");
  }
  return {
    status: response.status,
    cacheControl: response.headers.get("Cache-Control"),
    contentType: response.headers.get("Content-Type"),
    body: await response.json(),
  };
}

describe("dev-auth secret route", () => {
  beforeEach(() => {
    process.env.CONVEX_DEPLOYMENT = "dev:admired-dodo-615";
    process.env.DEV_AUTH_ENABLED = "1";
    process.env.DEV_AUTH_SECRET = "dev-auth-secret-with-enough-entropy-123";
  });

  afterEach(() => {
    restoreEnv("CONVEX_DEPLOYMENT");
    restoreEnv("DEV_AUTH_CONVEX_DEPLOYMENT");
    restoreEnv("DEV_AUTH_ENABLED");
    restoreEnv("DEV_AUTH_SECRET");
  });

  it("returns the server-only cloud dev auth secret to localhost", async () => {
    const event = createEvent();

    await expect(runSecretRoute(event)).resolves.toEqual({
      status: 200,
      cacheControl: "no-store",
      contentType: "application/json; charset=utf-8",
      body: { devAuthSecret: "dev-auth-secret-with-enough-entropy-123" },
    });
  });

  it("does not return the secret to non-local hosts", async () => {
    const event = createEvent("https://preview.clawhub.ai/dev-auth/secret");

    await expect(runSecretRoute(event)).resolves.toMatchObject({
      status: 404,
      body: { devAuthSecret: null },
    });
  });

  it("does not trust a spoofed localhost host from a non-loopback client", async () => {
    const event = createEvent(
      "http://localhost:3001/dev-auth/secret",
      { host: "localhost:3001" },
      "203.0.113.10",
    );

    await expect(runSecretRoute(event)).resolves.toMatchObject({
      status: 404,
      body: { devAuthSecret: null },
    });
  });

  it("does not return a missing or short secret", async () => {
    process.env.DEV_AUTH_SECRET = "short";
    const event = createEvent();

    await expect(runSecretRoute(event)).resolves.toMatchObject({
      status: 404,
      body: { devAuthSecret: null },
    });
  });

  it("requires a cloud dev deployment", async () => {
    process.env.CONVEX_DEPLOYMENT = "prod:wry-manatee-359";
    const event = createEvent();

    await expect(runSecretRoute(event)).resolves.toMatchObject({
      status: 404,
      body: { devAuthSecret: null },
    });
  });

  it("uses the explicit dev auth deployment fallback when Convex deployment is blank", async () => {
    process.env.CONVEX_DEPLOYMENT = "";
    process.env.DEV_AUTH_CONVEX_DEPLOYMENT = "dev:admired-dodo-615";
    const event = createEvent();

    await expect(runSecretRoute(event)).resolves.toMatchObject({
      status: 200,
      body: { devAuthSecret: "dev-auth-secret-with-enough-entropy-123" },
    });
  });

  it("rejects cross-origin requests even on localhost", async () => {
    const event = createEvent("http://localhost:3001/dev-auth/secret", {
      origin: "https://preview.clawhub.ai",
    });

    await expect(runSecretRoute(event)).resolves.toMatchObject({
      status: 404,
      body: { devAuthSecret: null },
    });
  });

  it("rejects cross-origin referers even on localhost", async () => {
    const event = createEvent("http://localhost:3001/dev-auth/secret", {
      referer: "https://preview.clawhub.ai/page",
    });

    await expect(runSecretRoute(event)).resolves.toMatchObject({
      status: 404,
      body: { devAuthSecret: null },
    });
  });
});
