import { expect, test } from "@playwright/test";

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "local-auth plugin catalog API tests require the local dev auth runner",
);

test("plugin category browse API handles official-first scan-status exclusions", async ({
  request,
}) => {
  const convexSiteUrl = process.env.VITE_CONVEX_SITE_URL;
  expect(convexSiteUrl, "VITE_CONVEX_SITE_URL is required").toBeTruthy();

  const url = new URL("/api/v1/plugins", convexSiteUrl);
  url.searchParams.set("limit", "25");
  url.searchParams.set("category", "security");
  url.searchParams.set("officialFirst", "true");
  url.searchParams.set("sort", "downloads");
  url.searchParams.set("excludeScanStatus", "pending,suspicious");

  const response = await request.get(url.toString(), {
    headers: { Accept: "application/json" },
  });

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  const json = (await response.json()) as { items?: unknown[]; nextCursor?: string | null };
  expect(Array.isArray(json.items)).toBe(true);
  expect(json.nextCursor).toBeNull();
});
