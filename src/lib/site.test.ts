/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getClawHubSiteUrl, getPublicClawHubSiteUrl, normalizeClawHubSiteOrigin } from "./site";

function withServerEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function clearSiteEnv() {
  delete process.env.VITE_SITE_URL;
}

beforeEach(() => {
  clearSiteEnv();
});

afterEach(() => {
  clearSiteEnv();
});

describe("site helpers", () => {
  it("normalizes origins and maps legacy clawdhub hosts to clawhub.ai", () => {
    expect(normalizeClawHubSiteOrigin("https://example.com/some/path")).toBe("https://example.com");
    expect(normalizeClawHubSiteOrigin("https://clawdhub.com")).toBe("https://clawhub.ai");
    expect(normalizeClawHubSiteOrigin("https://www.clawdhub.com")).toBe("https://clawhub.ai");
    expect(normalizeClawHubSiteOrigin("https://auth.clawdhub.com")).toBe("https://clawhub.ai");
  });

  it("returns null for missing or invalid origins", () => {
    expect(normalizeClawHubSiteOrigin(null)).toBeNull();
    expect(normalizeClawHubSiteOrigin(undefined)).toBeNull();
    expect(normalizeClawHubSiteOrigin("")).toBeNull();
    expect(normalizeClawHubSiteOrigin("not a url")).toBeNull();
  });

  it("returns default and env configured site URLs", () => {
    expect(getClawHubSiteUrl()).toBe("https://clawhub.ai");
    withServerEnv({ VITE_SITE_URL: "https://example.com" }, () => {
      expect(getClawHubSiteUrl()).toBe("https://example.com");
    });
    withServerEnv({ VITE_SITE_URL: "https://clawdhub.com" }, () => {
      expect(getClawHubSiteUrl()).toBe("https://clawhub.ai");
    });
    withServerEnv({ VITE_SITE_URL: "https://auth.clawdhub.com" }, () => {
      expect(getClawHubSiteUrl()).toBe("https://clawhub.ai");
    });
    withServerEnv({ VITE_SITE_URL: "not a url" }, () => {
      expect(getClawHubSiteUrl()).toBe("https://clawhub.ai");
    });
  });

  it("keeps shareable URLs public during local development", () => {
    withServerEnv({ VITE_SITE_URL: "http://localhost:3030" }, () => {
      expect(getPublicClawHubSiteUrl()).toBe("https://clawhub.ai");
    });
    withServerEnv({ VITE_SITE_URL: "https://example.com" }, () => {
      expect(getPublicClawHubSiteUrl()).toBe("https://example.com");
    });
  });
});
