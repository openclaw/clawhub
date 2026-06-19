import { getSkillIconCategoryForSkill } from "../lib/categories";
import { getCategoryIconComponent, UNRESOLVED_SKILL_CATEGORY_ICON } from "../lib/categoryIcons";
import { MARKETPLACE_KIND_ICONS, type MarketplaceIconKind } from "../lib/marketplaceIcons";

type MarketplaceIconProps = {
  kind: MarketplaceIconKind;
  label: string;
  imageUrl?: string | null;
  /** Legacy skill custom-icon value. Ignored for rendering. */
  icon?: string | null;
  skill?: {
    categories?: readonly string[] | null;
    inferredCategories?: readonly string[] | null;
    latestVersionId?: string | null;
    inferredFromVersionId?: string | null;
    slug?: string | null;
    displayName: string;
    summary?: string | null;
  } | null;
  size?: "xs" | "sm" | "md";
};

const TONES = [
  { accent: "oklch(0.63 0.16 42)", wash: "oklch(0.95 0.04 42)" },
  { accent: "oklch(0.61 0.15 168)", wash: "oklch(0.95 0.04 168)" },
  { accent: "oklch(0.59 0.14 236)", wash: "oklch(0.95 0.04 236)" },
  { accent: "oklch(0.66 0.13 92)", wash: "oklch(0.96 0.04 92)" },
] as const;

function hashTone(label: string) {
  let sum = 0;
  for (const char of label) sum += char.charCodeAt(0);
  return TONES[sum % TONES.length] ?? TONES[0];
}

export function MarketplaceIcon({
  kind,
  label,
  imageUrl,
  skill,
  size = "sm",
}: MarketplaceIconProps) {
  const category = kind === "skill" && skill ? getSkillIconCategoryForSkill(skill) : null;
  const Icon =
    kind === "skill" && skill
      ? (getCategoryIconComponent(category?.icon) ?? UNRESOLVED_SKILL_CATEGORY_ICON)
      : MARKETPLACE_KIND_ICONS[kind];
  const tone = hashTone(label);

  return (
    <span
      className={`marketplace-icon marketplace-icon-${kind} marketplace-icon-${size}`}
      style={
        {
          "--marketplace-icon-accent": tone.accent,
          "--marketplace-icon-wash": tone.wash,
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      {imageUrl ? (
        <img className="marketplace-icon-image" src={imageUrl} alt="" loading="lazy" />
      ) : (
        <Icon className="marketplace-icon-glyph" strokeWidth={1.8} />
      )}
    </span>
  );
}
