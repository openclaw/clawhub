import { useState, type ReactNode, type SyntheticEvent } from "react";
import { cn } from "../lib/utils";

export function DetailMobileDeferredSection({
  summary = "Details",
  children,
  className,
}: {
  summary?: string;
  children: ReactNode;
  className?: string;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    setMobileOpen(event.currentTarget.open);
  };

  return (
    <details
      className={cn("detail-mobile-deferred", className)}
      open={mobileOpen}
      onToggle={handleToggle}
    >
      <summary className="detail-mobile-deferred-summary">{summary}</summary>
      <div className="detail-mobile-deferred-body">{children}</div>
    </details>
  );
}
