import type { Page } from "@playwright/test";

export async function routeVercelProtectionBypass(page: Page) {
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  const baseURL = process.env.PLAYWRIGHT_BASE_URL?.trim();
  if (!bypassSecret || !baseURL) return;

  const origin = new URL(baseURL).origin;
  await page.route(`${origin}/**`, async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        "x-vercel-protection-bypass": bypassSecret,
      },
    });
  });
}
