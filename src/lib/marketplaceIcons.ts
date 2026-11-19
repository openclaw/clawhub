import { Building2, Package, Plug, User, Wrench } from "lucide-react";
import type { ComponentType } from "react";
import { BlobsterIcon } from "../components/BlobsterIcon";

export type MarketplaceIconKind = "skill" | "plugin" | "template" | "user" | "org";
export type MarketplaceIconComponent = ComponentType<{ size?: number; className?: string }>;

export const MARKETPLACE_KIND_ICONS = {
  skill: Package,
  plugin: Plug,
  template: BlobsterIcon,
  user: User,
  org: Building2,
} as const satisfies Record<MarketplaceIconKind, MarketplaceIconComponent>;

export const SKILL_NAV_ICON = Wrench;
export const PLUGIN_NAV_ICON = MARKETPLACE_KIND_ICONS.plugin;
