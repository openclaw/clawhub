import {
  BookOpen,
  Bot,
  Brain,
  Cloud,
  Code2,
  Cpu,
  Database,
  FileText,
  Folder,
  GitBranch,
  Globe,
  Lock,
  Package,
  Palette,
  Plug,
  Search,
  Sparkles,
  Terminal,
  Wrench,
  Zap,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

type LucideIconComponent = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Phase 1 lets users pick from this curated lucide icon set. Future phases
 * (uploads or external URLs) will reuse the same `skill.icon` field (a
 * protocol string) without introducing additional table columns.
 */
export const ALLOWED_LUCIDE_ICONS: Record<string, LucideIconComponent> = {
  Plug,
  FileText,
  Package,
  Code2,
  Wrench,
  Database,
  Bot,
  Brain,
  Globe,
  Search,
  GitBranch,
  Cpu,
  Cloud,
  Lock,
  Sparkles,
  Terminal,
  Zap,
  BookOpen,
  Folder,
  Palette,
};

export const ALLOWED_LUCIDE_ICON_NAMES = Object.keys(ALLOWED_LUCIDE_ICONS) as ReadonlyArray<
  keyof typeof ALLOWED_LUCIDE_ICONS
>;

type SkillIconDescriptor =
  | { kind: "lucide"; name: string; component: LucideIconComponent }
  | { kind: "url"; url: string }
  | { kind: "storage"; storageId: string };

/**
 * Parse a `skill.icon` protocol string. Returns `null` for unknown protocols
 * or icons that are not in the allow-list, leaving the caller to fall back
 * to a default icon.
 */
export function parseSkillIcon(raw: string | null | undefined): SkillIconDescriptor | null {
  if (!raw) return null;
  const colonIndex = raw.indexOf(":");
  if (colonIndex <= 0) return null;
  const kind = raw.slice(0, colonIndex).toLowerCase();
  const value = raw.slice(colonIndex + 1).trim();
  if (!value) return null;

  if (kind === "lucide") {
    // `Object.hasOwn` guards against prototype keys like `toString` /
    // `constructor`: bracket-access on a plain `Record<string, ...>` would
    // otherwise resolve them to `Object.prototype` members and try to
    // render them as React components downstream.
    const component = Object.hasOwn(ALLOWED_LUCIDE_ICONS, value)
      ? ALLOWED_LUCIDE_ICONS[value]
      : undefined;
    return component ? { kind: "lucide", name: value, component } : null;
  }
  if (kind === "url") {
    return { kind: "url", url: value };
  }
  if (kind === "storage") {
    return { kind: "storage", storageId: value };
  }
  return null;
}

/** Pack a whitelisted icon name into a `lucide:<Name>` protocol string. */
export function makeLucideIconValue(name: keyof typeof ALLOWED_LUCIDE_ICONS): string {
  return `lucide:${name}`;
}
