import * as React from "react";
import { cn } from "../../lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "accent" | "compact" | "pending" | "success" | "warning" | "destructive";
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        // Base styles
        "inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] text-fs-sm font-semibold",
        // Variant styles — all token-driven, no dark: overrides needed
        variant === "default" && "bg-hover-bg px-3 py-1 text-ink-soft border border-line",
        variant === "accent" && "bg-active-bg px-3 py-1 text-accent-deep border border-line",
        variant === "compact" && "bg-hover-bg px-2.5 py-0.5 text-fs-xs text-ink-soft border border-line",
        variant === "pending" && "bg-status-warning-bg px-3 py-1 text-status-warning-fg border border-line",
        variant === "success" && "bg-status-success-bg px-3 py-1 text-status-success-fg border border-line",
        variant === "warning" && "bg-status-warning-bg px-3 py-1 text-status-warning-fg border border-line",
        variant === "destructive" && "bg-status-error-bg px-3 py-1 text-status-error-fg border border-line",
        className,
      )}
      {...props}
    />
  ),
);
Badge.displayName = "Badge";

export { Badge };
