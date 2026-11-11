import { validateTemplateManifest, type TemplateManifest } from "clawhub-schema";
import { parseDocument } from "yaml";

export function parseTemplateDocument(contents: string | null): {
  markdown: string | null;
  manifest: TemplateManifest | null;
} {
  if (contents === null) return { markdown: null, manifest: null };
  const normalized = contents.replace(/^\uFEFF/, "");
  const frontmatter = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) return { markdown: normalized, manifest: null };
  const markdown = normalized.slice(frontmatter[0].length).trim();
  try {
    const document = parseDocument(frontmatter[1], { uniqueKeys: true });
    if (document.errors.length) return { markdown, manifest: null };
    const result = validateTemplateManifest(document.toJS({ maxAliasCount: 0 }));
    return { markdown, manifest: result.ok ? result.manifest : null };
  } catch {
    return { markdown, manifest: null };
  }
}

/** The package entry point can live below the package root. */
export function getTemplateManifestPath(packageJson: string | null): string {
  try {
    const value = JSON.parse(packageJson ?? "null");
    const path: unknown = value?.openclaw?.template;
    if (
      typeof path === "string" &&
      !path.startsWith("/") &&
      !path.includes("\\") &&
      path.split("/").every((part) => part && part !== "." && part !== "..") &&
      path.split("/").at(-1) === "CLAW.md"
    )
      return path;
  } catch {
    // Older registries may not expose package.json previews.
  }
  return "CLAW.md";
}
