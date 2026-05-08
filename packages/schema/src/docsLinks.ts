export const OPENCLAW_DOCS_BASE_URL = "https://docs.openclaw.ai";

export function openClawDocsUrl(path: string) {
  const trimmed = path.trim().replace(/^\/+/, "");
  return new URL(trimmed, `${OPENCLAW_DOCS_BASE_URL}/`).href;
}

export const DocsLinks = {
  clawhub: {
    acceptableUsage: openClawDocsUrl("clawhub/acceptable-usage"),
    publishing: openClawDocsUrl("clawhub/publishing"),
  },
  openclaw: {
    pluginPackageMetadata: openClawDocsUrl("plugins/sdk-setup#package-metadata"),
  },
} as const;
