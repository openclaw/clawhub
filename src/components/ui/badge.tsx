import * as React from "react";
import { cn } from "../../lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: "default" | "sm";
  variant?:
    | "default"
    | "accent"
    | "compact"
    | "pending"
    | "success"
    | "official"
    | "warning"
    | "review"
    | "destructive";
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, size = "default", variant = "default", ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        // Base styles
        "inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] text-fs-sm font-semibold",
        // Variant styles — all token-driven, no dark: overrides needed
        variant === "default" && "bg-hover-bg px-3 py-1 text-ink-soft border border-line",
        variant === "accent" && "bg-active-bg px-3 py-1 text-accent-deep border border-line",
        variant === "compact" &&
          "bg-hover-bg px-2.5 py-0.5 text-fs-xs text-ink-soft border border-line",
        variant === "pending" && "bg-hover-bg px-3 py-1 text-ink-soft border border-line",
        variant === "success" &&
          "bg-status-success-bg px-3 py-1 text-status-success-fg border border-line",
        variant === "official" &&
          "bg-[color:var(--official-bg)] px-3 py-1 text-[color:var(--official-fg)] border border-[color:var(--official-border)]",
        variant === "warning" &&
          "bg-status-warning-bg px-3 py-1 text-status-warning-fg border border-line",
        variant === "review" &&
          "bg-[color:var(--oc-status-info-bg)] px-3 py-1 text-[color:var(--oc-status-info-fg)] border border-[color:color-mix(in_srgb,var(--oc-status-info-fg)_28%,var(--oc-border-subtle))]",
        variant === "destructive" &&
          "bg-status-error-bg px-3 py-1 text-status-error-fg border border-line",
        size === "sm" &&
          "rounded-[var(--radius-pill)] px-2 py-0.5 text-[11px] font-medium leading-4",
        className,
      )}
      {...props}
    />
  ),
);
Badge.displayName = "Badge";

export { Badge };
