import JSON5 from "json5";
import { parseDocument } from "yaml";
import { validateOpenClawExternalCodePluginPackageContents } from "./openclawContract.js";
import {
  bundlePluginRuntimeId,
  selectPluginManifest,
  PLUGIN_BUNDLE_MANIFESTS,
} from "./pluginInput.js";
import { portablePathKey } from "./templatePaths.js";
import type { TemplateManifest } from "./templates.js";

export type TemplatePackageFile = { path: string; text?: string; size?: number };
const MAX_FILE_BYTES = 1024 * 1024;
// Native plugin metadata readers have a smaller bound than ordinary support files.
const MAX_PLUGIN_MANIFEST_BYTES = 256 * 1024;
const MAX_DIRECTORY_BYTES = 20 * 1024 * 1024;
const MAX_ENTRIES = 4096;
const MAX_DEPTH = 16;

/** Match native directory detection precedence without narrowing ordinary package publication. */
export function selectTemplateBundledPluginManifest(paths: readonly string[]) {
  for (const format of ["codex", "cursor", "claude"] as const) {
    const marker = PLUGIN_BUNDLE_MANIFESTS.find((entry) => entry.format === format);
    if (marker && paths.includes(marker.path))
      return selectPluginManifest({ family: "bundle-plugin", paths: [marker.path] });
  }
  if (paths.includes("openclaw.plugin.json"))
    return selectPluginManifest({ family: "code-plugin", paths: [...paths] });
  if (paths.includes("plugin.json")) return { path: "plugin.json", format: "agent" as const };
  return selectPluginManifest({ family: "code-plugin", paths: [...paths] });
}

/** Only artifact-selected metadata is interpreted; binary support files retain their verified size. */
export function validateTemplateBundledSources(
  manifest: TemplateManifest,
  files: readonly TemplatePackageFile[],
) {
  const sources: Array<{ kind: "skill" | "plugin"; path: string; name?: string }> = [];
  let totalBytes = 0;
  let totalFiles = 0;
  for (const collection of ["skills", "plugins"] as const) {
    for (const declaration of manifest[collection] ?? []) {
      if (!("path" in declaration)) continue;
      const path = declaration.path;
      const selected = files.filter(
        (file) =>
          file.path.startsWith(`${path}/`) &&
          !portablePathKey(file.path.slice(path.length + 1))
            .split("/")
            .some((part) => part === ".git" || part === "node_modules"),
      );
      if (!selected.length || files.some((file) => file.path === path))
        throw new Error(`Bundled dependency ${path} must be a non-empty package directory.`);
      const entries = new Map<string, string>();
      for (const file of selected) {
        const segments = file.path.slice(path.length + 1).split("/");
        if (segments.length > MAX_DEPTH)
          throw new Error(`Bundled dependency ${path} exceeds its directory depth limit.`);
        for (let index = 1; index <= segments.length; index++) {
          const entryPath = segments.slice(0, index).join("/");
          const key = portablePathKey(entryPath);
          const existing = entries.get(key);
          if (existing !== undefined && existing !== entryPath)
            throw new Error(`Bundled dependency ${path} has colliding directory paths.`);
          entries.set(key, entryPath);
        }
        const size =
          file.size ??
          (file.text === undefined ? undefined : new TextEncoder().encode(file.text).byteLength);
        if (size === undefined || !Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES)
          throw new Error(
            `Bundled dependency file ${file.path} is missing its verified size or exceeds ${MAX_FILE_BYTES} bytes.`,
          );
        totalBytes += size;
        totalFiles++;
      }
      if (
        entries.size > MAX_ENTRIES ||
        totalFiles > MAX_ENTRIES ||
        totalBytes > MAX_DIRECTORY_BYTES
      )
        throw new Error("Bundled dependencies exceed their file count or total byte limit.");
      const relative = selected.map((file) => ({
        ...file,
        path: file.path.slice(path.length + 1),
      }));
      const text = (entry: string, maxBytes?: number) => {
        const file = relative.find((candidate) => candidate.path === entry);
        if (file?.text === undefined)
          throw new Error(`Bundled dependency ${path} requires UTF-8 ${entry}.`);
        if (
          maxBytes !== undefined &&
          Math.max(file.size ?? 0, new TextEncoder().encode(file.text).byteLength) > maxBytes
        )
          throw new Error(`Bundled plugin manifest ${path}/${entry} exceeds ${maxBytes} bytes.`);
        return file.text;
      };
      let name: string | undefined;
      if (collection === "skills") {
        const match = text("SKILL.md")
          .replace(/^\uFEFF/, "")
          .match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
        if (!match) throw new Error(`Bundled skill ${path} requires SKILL.md frontmatter.`);
        const document = parseDocument(match[1], { uniqueKeys: true });
        const metadata = document.toJSON() as unknown;
        if (
          document.errors.length ||
          !isRecord(metadata) ||
          typeof metadata.description !== "string" ||
          !metadata.description.trim()
        )
          throw new Error(`Bundled skill ${path} requires valid SKILL.md with a description.`);
        name = typeof metadata.name === "string" ? metadata.name.trim() || undefined : undefined;
      } else {
        const paths = relative.map((file) => file.path);
        const marker = selectTemplateBundledPluginManifest(paths);
        const metadata: unknown = JSON5.parse(text(marker.path, MAX_PLUGIN_MANIFEST_BYTES));
        if (!isRecord(metadata))
          throw new Error(`Bundled plugin ${path} requires an object manifest.`);
        if (marker.format === "agent") {
          throw new Error(
            metadata.$schema === "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
              ? "Agent plugin bundles are not supported by Templates."
              : `Bundled plugin ${path} requires an explicit supported native manifest.`,
          );
        }
        if (marker.format) {
          bundlePluginRuntimeId(metadata);
          name = String(metadata.name).trim();
        } else {
          if (
            typeof metadata.id !== "string" ||
            !metadata.id.trim() ||
            !isRecord(metadata.configSchema)
          )
            throw new Error(`Bundled plugin ${path} requires native id and configSchema metadata.`);
          const packageJson: unknown = JSON.parse(text("package.json"));
          const openclaw =
            isRecord(packageJson) && isRecord(packageJson.openclaw)
              ? packageJson.openclaw
              : undefined;
          if (
            !Array.isArray(openclaw?.extensions) ||
            !openclaw.extensions.length ||
            openclaw.extensions.some((entry) => typeof entry !== "string" || !entry.trim())
          )
            throw new Error(`Bundled plugin ${path} requires package.json openclaw.extensions.`);
          const validation = validateOpenClawExternalCodePluginPackageContents(packageJson, paths);
          // Compatibility publication claims belong to independently published code plugins.
          const entryIssues = validation.issues.filter(
            (issue) =>
              issue.fieldPath !== "openclaw.compat.pluginApi" &&
              issue.fieldPath !== "openclaw.build.openclawVersion",
          );
          if (entryIssues.length)
            throw new Error(entryIssues.map((issue) => issue.message).join(" "));
          name =
            typeof metadata.name === "string" && metadata.name.trim()
              ? metadata.name.trim()
              : metadata.id.trim();
        }
      }
      sources.push({
        kind: collection === "skills" ? "skill" : "plugin",
        path,
        ...(name ? { name } : {}),
      });
    }
  }
  return sources;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
