import { BadgeCheck } from "lucide-react";
import { Badge } from "./ui/badge";

export function VerifiedBadge() {
  return (
    <Badge variant="compact" className="verified-badge">
      <BadgeCheck size={14} aria-hidden="true" className="verified-badge-icon" />
      Verified
    </Badge>
  );
}
