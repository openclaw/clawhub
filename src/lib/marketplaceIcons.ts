import { Building2, Package, Plug, User, Wrench } from "lucide-react";
import type { ComponentType } from "react";

export type MarketplaceIconKind = "skill" | "plugin" | "user" | "org";
export type MarketplaceIconComponent = ComponentType<{ size?: number; className?: string }>;

export const MARKETPLACE_KIND_ICONS = {
  skill: Package,
  plugin: Plug,
  user: User,
  org: Building2,
} as const satisfies Record<MarketplaceIconKind, MarketplaceIconComponent>;

export const NAV_ICONS = {
  wrench: Wrench,
  plug: MARKETPLACE_KIND_ICONS.plugin,
  user: MARKETPLACE_KIND_ICONS.user,
} as const satisfies Record<string, MarketplaceIconComponent>;

export const SKILL_NAV_ICON = Wrench;
export const PLUGIN_NAV_ICON = MARKETPLACE_KIND_ICONS.plugin;
