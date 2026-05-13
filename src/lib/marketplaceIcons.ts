import { Building2, FileText, Package, Plug, User, Wrench } from "lucide-react";
import type { ComponentType } from "react";

export type MarketplaceIconKind = "skill" | "plugin" | "soul" | "user" | "org";
export type MarketplaceIconComponent = ComponentType<{ size?: number; className?: string }>;

export const MARKETPLACE_KIND_ICONS = {
  skill: Package,
  plugin: Plug,
  soul: FileText,
  user: User,
  org: Building2,
} as const satisfies Record<MarketplaceIconKind, MarketplaceIconComponent>;

export const NAV_ICONS = {
  wrench: Wrench,
  plug: MARKETPLACE_KIND_ICONS.plugin,
  ghost: MARKETPLACE_KIND_ICONS.soul,
} as const satisfies Record<string, MarketplaceIconComponent>;

export const SKILL_NAV_ICON = Wrench;
export const PLUGIN_NAV_ICON = MARKETPLACE_KIND_ICONS.plugin;
