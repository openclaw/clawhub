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

export type TemplateWorkspaceEntry = { name: string; path: string };
export type TemplateWorkspaceContents = {
  skills: TemplateWorkspaceEntry[];
  plugins: TemplateWorkspaceEntry[];
  heartbeat: { path: string; every?: string } | null;
};

// OpenClaw's native workspace discovery locations, relative to the agent workspace.
const WORKSPACE_SKILL_FILE = /^(?:\.agents\/)?skills\/(?:[^/]+\/)*([^/]+)\/SKILL\.md$/;
const WORKSPACE_PLUGIN_MANIFEST = /^\.openclaw\/extensions\/([^/]+)\/openclaw\.plugin\.json$/;
const WORKSPACE_HEARTBEAT_FILE = "HEARTBEAT.md";

/**
 * Workspace files can land where OpenClaw natively discovers skills, plugins and heartbeat
 * work. They are not declared dependencies, so this projection is display-only: it never
 * feeds the dependency inventory, summary counts or validation.
 */
export function templateWorkspaceContents(manifest: TemplateManifest): TemplateWorkspaceContents {
  const destinations = [
    ...Object.keys(manifest.workspace?.bootstrapFiles ?? {}),
    ...(manifest.workspace?.files ?? []).map((file) => file.path.replaceAll("\\", "/")),
  ];
  const collect = (pattern: RegExp) =>
    destinations.flatMap((path): TemplateWorkspaceEntry[] => {
      const name = pattern.exec(path)?.[1];
      return name ? [{ name, path }] : [];
    });
  const every = manifest.agent.heartbeat?.every;
  const skillFiles = collect(WORKSPACE_SKILL_FILE);
  const skillDirs = skillFiles.map((entry) => entry.path.slice(0, -"SKILL.md".length));
  return {
    // OpenClaw stops descending once a directory holds SKILL.md, so a SKILL.md below an
    // identified skill is one of its support files rather than another skill.
    skills: skillFiles.filter(
      (entry, index) =>
        !skillDirs.some((dir, other) => other !== index && entry.path.startsWith(dir)),
    ),
    plugins: collect(WORKSPACE_PLUGIN_MANIFEST),
    heartbeat: destinations.includes(WORKSPACE_HEARTBEAT_FILE)
      ? { path: WORKSPACE_HEARTBEAT_FILE, ...(every ? { every } : {}) }
      : null,
  };
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
