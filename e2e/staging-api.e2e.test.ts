/* @vitest-environment node */

import { describe, expect, it } from "vitest";

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the staging API smoke`);
  return value;
}

describe("staging API smoke", () => {
  it("serves the permanent staging backend without requiring seeded content", async () => {
    const site = new URL(requiredEnv("CLAWHUB_E2E_SITE"));
    const expectedBackend = requiredEnv("CLAWHUB_E2E_EXPECT_STAGING_BACKEND");
    const expectedSha = requiredEnv("CLAWHUB_E2E_EXPECT_STAGING_SHA");
    if (site.hostname === "clawhub.ai" || site.hostname === "www.clawhub.ai") {
      throw new Error("The staging API smoke cannot target the production site");
    }

    const headers = new Headers({ Accept: "application/json" });
    const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
    if (bypassSecret) headers.set("x-vercel-protection-bypass", bypassSecret);
    const response = await fetch(new URL("/api/v1/skills?limit=1", site), {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();

    expect(response.status, body.slice(0, 300)).toBe(200);
    expect(response.headers.get("x-clawhub-staging-backend")).toBe(expectedBackend);
    expect(response.headers.get("x-clawhub-staging-build-sha")).toBe(expectedSha);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(JSON.parse(body)).toMatchObject({ items: expect.any(Array) });
  });
});
