import {
  Activity,
  BookOpen,
  Bot,
  Brain,
  CalendarDays,
  ChartNoAxesCombined,
  CodeXml,
  Database,
  Files,
  GitBranch,
  Globe,
  Inbox,
  ListChecks,
  ListTodo,
  Megaphone,
  MessageCircle,
  MessageSquare,
  Package,
  Palette,
  Plug,
  Search,
  Server,
  Shield,
  Shapes,
  Slash,
  WalletCards,
  Wrench,
  Workflow,
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
  bot: Bot,
  brain: Brain,
  "calendar-days": CalendarDays,
  "chart-no-axes-combined": ChartNoAxesCombined,
  "code-xml": CodeXml,
  database: Database,
  files: Files,
  "git-branch": GitBranch,
  globe: Globe,
  inbox: Inbox,
  "list-checks": ListChecks,
  "list-todo": ListTodo,
  megaphone: Megaphone,
  "message-circle": MessageCircle,
  "message-square": MessageSquare,
  package: Package,
  palette: Palette,
  plug: Plug,
  search: Search,
  server: Server,
  shield: Shield,
  shapes: Shapes,
  "wallet-cards": WalletCards,
  wrench: Wrench,
  workflow: Workflow,
  zap: Zap,
} as const satisfies Record<string, CategoryIconComponent>;

export function getCategoryIconComponent(iconName: string | null | undefined) {
  if (!iconName) return null;
  return Object.hasOwn(CATEGORY_ICONS, iconName)
    ? CATEGORY_ICONS[iconName as keyof typeof CATEGORY_ICONS]
    : null;
}

export const UNRESOLVED_SKILL_CATEGORY_ICON = Slash;
