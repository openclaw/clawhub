import type { ClawdisSkillMetadata, SkillInstallSpec } from "clawhub-schema";
import type { Id } from "../../convex/_generated/dataModel";
import { getClawHubSiteUrl } from "../lib/site";

export type SkillPromptMode = "install-only" | "install-and-setup";
type SkillPackageManager = "npm" | "pnpm" | "bun";

function assertNever(value: never): never {
  throw new Error(`Unsupported package manager: ${String(value)}`);
}

type SkillOwnerId = Id<"users"> | Id<"publishers">;

type SkillPromptContext = {
  mode: SkillPromptMode;
  skillName: string;
  slug: string;
  ownerHandle: string | null;
  ownerId: SkillOwnerId | null;
  clawdis?: ClawdisSkillMetadata;
};

export function buildSkillHref(
  ownerHandle: string | null,
  ownerId: Id<"users"> | Id<"publishers"> | null,
  slug: string,
) {
  const owner = ownerHandle?.trim() || (ownerId ? String(ownerId) : "unknown");
  return `/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`;
}

export function formatConfigSnippet(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed || raw.includes("\n")) return raw;
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    // fall through
  }

  let out = "";
  let indent = 0;
  let inString = false;
  let isEscaped = false;

  const newline = () => {
    out = out.replace(/[ \t]+$/u, "");
    out += `\n${" ".repeat(indent * 2)}`;
  };

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      out += ch;
      if (isEscaped) {
        isEscaped = false;
      } else if (ch === "\\") {
        isEscaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === "{" || ch === "[") {
      out += ch;
      indent += 1;
      newline();
      continue;
    }

    if (ch === "}" || ch === "]") {
      indent = Math.max(0, indent - 1);
      newline();
      out += ch;
      continue;
    }

    if (ch === ";" || ch === ",") {
      out += ch;
      newline();
      continue;
    }

    if (ch === "\n" || ch === "\r" || ch === "\t") {
      continue;
    }

    if (ch === " ") {
      if (out.endsWith(" ") || out.endsWith("\n")) {
        continue;
      }
      out += " ";
      continue;
    }

    out += ch;
  }

  return out.trim();
}

export function stripFrontmatter(content: string) {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) return content;
  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) return content;
  return normalized.slice(endIndex + 4).replace(/^\n+/, "");
}

export function formatOsList(os?: string[]) {
  if (!os?.length) return [];
  return os.map((entry) => {
    const key = entry.trim().toLowerCase();
    if (key === "darwin" || key === "macos" || key === "mac") return "macOS";
    if (key === "linux") return "Linux";
    if (key === "windows" || key === "win32") return "Windows";
    return entry;
  });
}

function formatSystemsList(systems?: string[]): string[] {
  if (!systems?.length) return [];
  const labels: Record<string, string> = {
    "aarch64-darwin": "macOS ARM64",
    "x86_64-darwin": "macOS x86_64",
    "aarch64-linux": "Linux ARM64",
    "x86_64-linux": "Linux x86_64",
  };
  return systems.map((s) => labels[s.trim()] ?? s);
}

export function getPlatformLabels(os?: string[], systems?: string[]): string[] {
  if (systems?.length) return formatSystemsList(systems);
  if (os?.length) return formatOsList(os);
  return [];
}

export function formatInstallLabel(spec: SkillInstallSpec) {
  if (spec.kind === "brew") return "Homebrew";
  if (spec.kind === "node") return "Node";
  if (spec.kind === "go") return "Go";
  if (spec.kind === "uv") return "uv";
  return "Install";
}

export function formatInstallCommand(spec: SkillInstallSpec) {
  if (spec.kind === "brew" && spec.formula) {
    if (spec.tap && !spec.formula.includes("/")) {
      return `brew install ${spec.tap}/${spec.formula}`;
    }
    return `brew install ${spec.formula}`;
  }
  if (spec.kind === "node" && spec.package) {
    return `npm i -g ${spec.package}`;
  }
  if (spec.kind === "go" && spec.module) {
    return `go install ${spec.module}`;
  }
  if (spec.kind === "uv" && spec.package) {
    return `uv tool install ${spec.package}`;
  }
  return null;
}

export function buildSkillInstallTarget(
  ownerHandle: string | null,
  ownerId: SkillOwnerId | null,
  slug: string,
) {
  const handle = ownerHandle?.trim();
  if (handle) return `${handle}/${slug}`;
  if (ownerId) return `${String(ownerId)}/${slug}`;
  return slug;
}

export function buildSkillPageUrl(
  ownerHandle: string | null,
  ownerId: SkillOwnerId | null,
  slug: string,
) {
  const handle = ownerHandle?.trim();
  const owner = handle || (ownerId ? String(ownerId) : null);
  if (!owner) return null;

  const path = `/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`;
  return new URL(path, getClawHubSiteUrl()).toString();
}

export function formatOpenClawInstallCommand(slug: string) {
  return `openclaw skills install ${slug}`;
}

export function formatClawHubInstallCommand(slug: string, pm: SkillPackageManager) {
  switch (pm) {
    case "npm":
      return `npx clawhub@latest install ${slug}`;
    case "pnpm":
      return `pnpm dlx clawhub@latest install ${slug}`;
    case "bun":
      return `bunx clawhub@latest install ${slug}`;
  }

  return assertNever(pm);
}

export function formatOpenClawPrompt({
  mode,
  skillName,
  slug,
  ownerHandle,
  ownerId,
  clawdis,
}: SkillPromptContext) {
  const target = buildSkillInstallTarget(ownerHandle, ownerId, slug);
  const pageUrl = buildSkillPageUrl(ownerHandle, ownerId, slug);
  const displayName = skillName.trim() || slug;
  const requiredEnvVars = new Set(clawdis?.requires?.env ?? []);

  for (const envVar of clawdis?.envVars ?? []) {
    const name = envVar.name?.trim();
    if (!name) continue;
    if (envVar.required === false) continue;
    requiredEnvVars.add(name);
  }

  const lines = [`Install the skill "${displayName}" (${target}) from ClawHub.`];

  if (pageUrl) {
    lines.push(`Skill page: ${pageUrl}`);
  }

  lines.push("Keep the work scoped to this skill only.");

  if (mode === "install-only") {
    lines.push("Stop after the skill is installed.");
    return lines.join("\n");
  }

  lines.push("After install, inspect the skill metadata and help me finish setup.");

  if (requiredEnvVars.size > 0) {
    lines.push(`Required env vars: ${Array.from(requiredEnvVars).join(", ")}`);
  }
  if (clawdis?.requires?.bins?.length) {
    lines.push(`Required binaries: ${clawdis.requires.bins.join(", ")}`);
  }
  if (clawdis?.requires?.config?.length) {
    lines.push(`Config paths to check: ${clawdis.requires.config.join(", ")}`);
  }

  lines.push(
    "Use only the metadata you can verify from ClawHub; do not invent missing requirements.",
  );
  lines.push("Ask before making any broader environment changes.");
  return lines.join("\n");
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatNixInstallSnippet(plugin: string) {
  const snippet = `programs.clawdbot.plugins = [ { source = "${plugin}"; } ];`;
  return formatConfigSnippet(snippet);
}
