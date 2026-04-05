import { Slot } from "@radix-ui/react-slot";
import * as React from "react";
import { cn } from "../../lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Render as the child element (e.g. a Link) instead of a <button>. */
  asChild?: boolean;
  variant?: "default" | "primary" | "destructive" | "ghost" | "outline";
  size?: "default" | "sm" | "lg" | "icon";
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild, className, variant = "default", size = "default", loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(
          // Base styles matching .btn
          "inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-all duration-200 ease-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg)]",
          "disabled:pointer-events-none disabled:opacity-60",
          // Hover lift (matches .btn:hover)
          "hover:not-disabled:-translate-y-px hover:not-disabled:shadow-[0_10px_20px_rgba(29,26,23,0.12)]",
          // Variant styles
          variant === "default" &&
            "border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)]",
          variant === "primary" &&
            "border-none bg-gradient-to-br from-[color:var(--accent)] to-[color:var(--accent-deep)] text-white dark:from-[#c35640] dark:to-[#953827] dark:shadow-[0_10px_22px_rgba(58,23,16,0.42),inset_0_1px_0_rgba(255,201,184,0.18)]",
          variant === "destructive" &&
            "border border-red-300/40 bg-red-50 text-red-700 hover:not-disabled:bg-red-100 dark:border-red-500/30 dark:bg-red-950/50 dark:text-red-300",
          variant === "ghost" &&
            "border-transparent bg-transparent text-[color:var(--ink-soft)] hover:not-disabled:bg-[color:var(--surface-muted)] hover:not-disabled:text-[color:var(--ink)] hover:not-disabled:shadow-none hover:not-disabled:translate-y-0",
          variant === "outline" &&
            "border border-[color:var(--border-ui)] bg-transparent text-[color:var(--ink)] hover:not-disabled:border-[color:var(--border-ui-hover)] hover:not-disabled:bg-[color:var(--surface)]",
          // Size styles
          size === "default" && "min-h-[44px] rounded-[var(--radius-pill)] px-4 py-[11px] text-sm",
          size === "sm" && "min-h-[34px] rounded-[var(--radius-pill)] px-3 py-1.5 text-xs",
          size === "lg" && "min-h-[52px] rounded-[var(--radius-pill)] px-6 py-3 text-base",
          size === "icon" && "h-[44px] w-[44px] rounded-[var(--radius-pill)] p-0",
          className,
        )}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current/25 border-t-current" />
        )}
        {children}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button };
