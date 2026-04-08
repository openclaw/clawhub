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
        // Base styles matching .tag
        "inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] text-[0.8rem] font-semibold",
        // Variant styles
        variant === "default" && [
          "bg-[rgba(43,198,164,0.16)] px-3 py-1 text-[#1a6b5b]",
          "dark:bg-[rgba(232,106,71,0.2)] dark:text-[#ffd0bf]",
        ],
        variant === "accent" && [
          "bg-[rgba(255,107,74,0.16)] px-3 py-1 text-[color:var(--accent-deep)]",
          "dark:bg-[rgba(232,106,71,0.24)] dark:text-[#ffd0bf]",
        ],
        variant === "compact" && [
          "bg-[rgba(43,198,164,0.16)] px-2.5 py-0.5 text-[0.72rem] text-[#1a6b5b]",
          "dark:bg-[rgba(232,106,71,0.2)] dark:text-[#ffd0bf]",
        ],
        variant === "pending" && [
          "bg-[rgba(240,196,106,0.2)] px-3 py-1 text-[#8a6914]",
          "dark:bg-[rgba(243,201,122,0.18)] dark:text-[color:var(--gold)]",
        ],
        variant === "success" && [
          "bg-emerald-100 px-3 py-1 text-emerald-700",
          "dark:bg-emerald-900/30 dark:text-emerald-300",
        ],
        variant === "warning" && [
          "bg-amber-100 px-3 py-1 text-amber-700",
          "dark:bg-amber-900/30 dark:text-amber-300",
        ],
        variant === "destructive" && [
          "bg-red-100 px-3 py-1 text-red-700",
          "dark:bg-red-900/30 dark:text-red-300",
        ],
        className,
      )}
      {...props}
    />
  ),
);
Badge.displayName = "Badge";

export { Badge };
