import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../lib/utils";

const alertVariants = cva(
  "relative w-full rounded-[var(--radius-sm)] border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg+*]:pl-7",
  {
    variants: {
      variant: {
        default:
          "border-[color:var(--line)] bg-[color:var(--surface-muted)] text-[color:var(--ink)]",
        info: "border-[color:color-mix(in_srgb,#6aa9ff_36%,var(--line))] bg-[color:color-mix(in_srgb,#6aa9ff_14%,transparent)] text-[#8fbdff]",
        warn: "border-[color:color-mix(in_srgb,#f5c84b_38%,var(--line))] bg-[color:color-mix(in_srgb,#f5c84b_14%,transparent)] text-[#f5c84b]",
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
