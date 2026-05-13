import { Building2, FileText, Package, Plug, User } from "lucide-react";
import { parseSkillIcon } from "../lib/skillIcon";

type MarketplaceIconProps = {
  kind: "skill" | "plugin" | "soul" | "user" | "org";
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

function getIcon(kind: MarketplaceIconProps["kind"]) {
  switch (kind) {
    case "plugin":
      return Plug;
    case "soul":
      return FileText;
    case "user":
      return User;
    case "org":
      return Building2;
    default:
      return Package;
  }
}

export function MarketplaceIcon({
  kind,
  label,
  imageUrl,
  icon,
  size = "sm",
}: MarketplaceIconProps) {
  const customIcon = kind === "skill" ? parseSkillIcon(icon) : null;
  const Icon = getIcon(kind);
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
      ) : customIcon?.kind === "lucide" ? (
        <customIcon.component className="marketplace-icon-glyph" strokeWidth={1.8} />
      ) : (
        <Icon className="marketplace-icon-glyph" strokeWidth={1.8} />
      )}
    </span>
  );
}
