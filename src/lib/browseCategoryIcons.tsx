import { Layers, Package } from "lucide-react";
import { PLUGIN_CATEGORIES, SKILL_CATEGORIES } from "./categories";
import { getCategoryIconComponent } from "./categoryIcons";

type BrowseCategoryIconProps = {
  slug: string | null;
  icon?: string | null;
  size?: number;
  className?: string;
};

export function BrowseCategoryIcon({ slug, icon, size = 16, className }: BrowseCategoryIconProps) {
  if (!slug) {
    return <Layers size={size} className={className} aria-hidden="true" />;
  }
  const iconKey =
    icon ??
    [...SKILL_CATEGORIES, ...PLUGIN_CATEGORIES].find((category) => category.slug === slug)?.icon;
  const Icon = getCategoryIconComponent(iconKey) ?? Package;
  return <Icon size={size} className={className} aria-hidden="true" />;
}
