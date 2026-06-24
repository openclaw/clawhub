import { BadgeCheck } from "lucide-react";
import { Badge } from "./ui/badge";

export function OfficialTag({ className }: { className?: string }) {
  return (
    <Badge
      variant="official"
      className={className ? `official-tag rounded-full ${className}` : "official-tag rounded-full"}
      aria-label="Official"
    >
      <BadgeCheck size={15} aria-hidden="true" className="official-badge-icon" />
      Official
    </Badge>
  );
}

export function OfficialBadge({ className }: { className?: string }) {
  return (
    <span
      className={className ? `official-badge ${className}` : "official-badge"}
      aria-label="Official"
      title="Official"
    >
      <BadgeCheck size={12} aria-hidden="true" />
    </span>
  );
}
