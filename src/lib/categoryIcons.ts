import {
  Activity,
  BookOpen,
  Brain,
  Database,
  Globe,
  ListChecks,
  MessageCircle,
  MessageSquare,
  Package,
  Palette,
  Plug,
  Shield,
  Shapes,
  Slash,
  WalletCards,
  Wrench,
  Zap,
} from "lucide-react";
import type { ComponentType } from "react";

type CategoryIconComponent = ComponentType<{
  className?: string;
  size?: number;
  strokeWidth?: number;
}>;

const CATEGORY_ICONS = {
  activity: Activity,
  "book-open": BookOpen,
  brain: Brain,
  database: Database,
  globe: Globe,
  "list-checks": ListChecks,
  "message-circle": MessageCircle,
  "message-square": MessageSquare,
  package: Package,
  palette: Palette,
  plug: Plug,
  shield: Shield,
  shapes: Shapes,
  "wallet-cards": WalletCards,
  wrench: Wrench,
  zap: Zap,
} as const satisfies Record<string, CategoryIconComponent>;

export function getCategoryIconComponent(iconName: string | null | undefined) {
  if (!iconName) return null;
  return Object.hasOwn(CATEGORY_ICONS, iconName)
    ? CATEGORY_ICONS[iconName as keyof typeof CATEGORY_ICONS]
    : null;
}

export const UNRESOLVED_SKILL_CATEGORY_ICON = Slash;
