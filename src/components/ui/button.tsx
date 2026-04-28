import { Slot, Slottable } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-semibold transition-all duration-200 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg)]",
    "disabled:pointer-events-none disabled:opacity-60",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        default:
          "border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)] hover:not-disabled:-translate-y-px hover:not-disabled:shadow-hover",
        primary:
          "border border-accent bg-accent/10 text-[color:var(--ink)] hover:not-disabled:-translate-y-px hover:not-disabled:shadow-hover",
        secondary:
          "border border-[color:var(--line)] bg-[color:var(--surface-muted)] text-[color:var(--ink)] hover:not-disabled:-translate-y-px hover:not-disabled:shadow-hover",
        destructive:
          "border border-status-error-fg/20 bg-status-error-bg text-status-error-fg hover:not-disabled:-translate-y-px hover:not-disabled:bg-active-bg hover:not-disabled:shadow-hover",
        ghost:
          "border border-transparent bg-transparent text-[color:var(--ink-soft)] hover:not-disabled:bg-[color:var(--surface-muted)] hover:not-disabled:text-[color:var(--ink)]",
        outline:
          "border border-[color:var(--border-ui)] bg-transparent text-[color:var(--ink)] hover:not-disabled:-translate-y-px hover:not-disabled:border-[color:var(--border-ui-hover)] hover:not-disabled:bg-[color:var(--surface)] hover:not-disabled:shadow-hover",
        link: "h-auto border border-transparent bg-transparent p-0 text-[color:var(--accent-deep)] underline-offset-4 hover:underline disabled:opacity-60",
      },
      size: {
        default: "min-h-[44px] rounded-[var(--r-btn)] px-4 py-[11px] text-sm",
        xs: "min-h-[30px] rounded-[var(--r-btn)] px-2.5 py-1 text-xs",
        sm: "min-h-[34px] rounded-[var(--r-btn)] px-3 py-1.5 text-xs",
        lg: "min-h-[52px] rounded-[var(--r-btn)] px-6 py-3 text-base",
        icon: "h-[44px] w-[44px] rounded-[var(--r-btn)] p-0",
        "icon-xs": "h-7 w-7 rounded-[var(--r-btn)] p-0",
        "icon-sm": "h-8 w-8 rounded-[var(--r-btn)] p-0",
        "icon-lg": "h-12 w-12 rounded-[var(--r-btn)] p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Render as the child element (e.g. a Link) instead of a <button>. */
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      asChild,
      className,
      variant = "default",
      size = "default",
      loading,
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        data-slot="button"
        data-variant={variant}
        data-size={size}
        className={cn(buttonVariants({ variant, size, className }))}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current/25 border-t-current" />
        )}
        <Slottable>{children}</Slottable>
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
