import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../lib/utils";

const alertVariants = cva(
  "relative w-full rounded-[var(--oc-radius-control)] border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg+*]:pl-7",
  {
    variants: {
      variant: {
        default:
          "border-[color:var(--line)] bg-[color:var(--surface-muted)] text-[color:var(--ink)]",
        info: "border-[color:color-mix(in_srgb,var(--oc-status-info-fg)_32%,var(--oc-border-subtle))] bg-[color:var(--oc-status-info-bg)] text-[color:var(--oc-status-info-fg)]",
        warn: "border-[color:color-mix(in_srgb,var(--oc-status-warning-fg)_32%,var(--oc-border-subtle))] bg-[color:var(--oc-status-warning-bg)] text-[color:var(--oc-status-warning-fg)]",
        destructive:
          "border-[color:var(--status-error-border,var(--line))] bg-[color:var(--status-error-bg)] text-[color:var(--status-error-fg)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = "Alert";

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("m-0 leading-6 text-current", className)} {...props} />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertDescription };
