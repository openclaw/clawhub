import { BadgeCheck } from "lucide-react";
import { Badge } from "./ui/badge";

export function OfficialTag({ className }: { className?: string }) {
  return (
    <Badge
      variant="official"
      className={
        className
          ? `official-tag rounded-[var(--oc-radius-control)] ${className}`
          : "official-tag rounded-[var(--oc-radius-control)]"
      }
      aria-label="Verified"
    >
      <BadgeCheck size={15} aria-hidden="true" className="official-badge-icon" />
      Verified
    </Badge>
  );
}

type OfficialBadgeProps = {
  className?: string;
  iconOnly?: boolean;
  size?: number;
};

export function OfficialBadge({ className, iconOnly = false, size = 12 }: OfficialBadgeProps) {
  if (iconOnly) {
    const iconClassName = className
      ? `official-badge-icon-only ${className}`
      : "official-badge-icon-only";
    return <BadgeCheck size={size} className={iconClassName} aria-label="Verified" />;
  }

  return (
    <span
      className={className ? `official-badge ${className}` : "official-badge"}
      aria-label="Verified"
      title="Verified"
    >
      <BadgeCheck size={size} aria-hidden="true" />
    </span>
  );
}
