import { useEffect, useState, type CSSProperties } from "react";
import { MARKETPLACE_KIND_ICONS, type MarketplaceIconKind } from "../lib/marketplaceIcons";
import { parseSkillIcon } from "../lib/skillIcon";

type MarketplaceIconProps = {
  kind: MarketplaceIconKind;
  label: string;
  imageUrl?: string | null;
  /**
   * Skill custom-icon protocol string (e.g. `lucide:Plug`). Only honoured
   * when `kind === "skill"`; for other kinds the prop is ignored. Falls
   * back to the default kind icon when the value cannot be parsed or is
   * not in the client allow-list.
   */
  icon?: string | null;
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
  icon,
  size = "sm",
}: MarketplaceIconProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  useEffect(() => {
    setFailedImageUrl(null);
  }, [imageUrl]);

  const customIcon = kind === "skill" ? parseSkillIcon(icon) : null;
  const Icon = MARKETPLACE_KIND_ICONS[kind];
  const tone = hashTone(label);
  const visibleImageUrl = imageUrl && failedImageUrl !== imageUrl ? imageUrl : null;

  return (
    <span
      className={`marketplace-icon marketplace-icon-${kind} marketplace-icon-${size}`}
      style={
        {
          "--marketplace-icon-accent": tone.accent,
          "--marketplace-icon-wash": tone.wash,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      {visibleImageUrl ? (
        <img
          className="marketplace-icon-image"
          src={visibleImageUrl}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          decoding="async"
          onError={() => setFailedImageUrl(visibleImageUrl)}
        />
      ) : customIcon?.kind === "lucide" ? (
        <customIcon.component className="marketplace-icon-glyph" strokeWidth={1.8} />
      ) : (
        <Icon className="marketplace-icon-glyph" strokeWidth={1.8} />
      )}
    </span>
  );
}
