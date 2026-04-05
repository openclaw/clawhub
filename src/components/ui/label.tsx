import * as LabelPrimitive from "@radix-ui/react-label";
import * as React from "react";
import { cn } from "../../lib/utils";

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      // Matches .form-label
      "text-[0.74rem] font-bold uppercase tracking-[0.14em]",
      "text-[rgba(70,95,113,0.9)]",
      "dark:text-[rgba(206,227,238,0.76)]",
      "peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
      className,
    )}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
