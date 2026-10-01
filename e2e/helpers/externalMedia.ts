import type { Page } from "@playwright/test";

const OPENCLAW_MEDIA_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);

export function isKnownOpenClawMediaUrl(url: string) {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return false;
  }

  if (parsedUrl.origin !== "https://openclaw.ai") return false;
  if (parsedUrl.pathname === "/favicon.svg") return true;
  if (!parsedUrl.pathname.startsWith("/ecosystem/")) return false;

  const extension = parsedUrl.pathname.match(/\.[^./]+$/)?.[0]?.toLowerCase();
  return extension !== undefined && OPENCLAW_MEDIA_EXTENSIONS.has(extension);
}

export async function stubExternalMediaInVitePreview(page: Page) {
  if (process.env.PLAYWRIGHT_BASE_URL) return;

  await page.route("**/_vercel/image?**", (route) => route.fulfill({ status: 204 }));

  await page.route("https://openclaw.ai/**", (route) => {
    if (isKnownOpenClawMediaUrl(route.request().url())) {
      return route.fulfill({ status: 204 });
    }
    return route.continue();
  });
}
