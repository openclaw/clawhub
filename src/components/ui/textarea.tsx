import * as React from "react";
import { cn } from "../../lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      // Base styles
      "w-full min-h-[100px] resize-y rounded-[var(--radius-sm)] border px-3.5 py-space-3 text-[color:var(--ink)] transition-all duration-[180ms] ease-out",
      "border-input-border bg-input-bg",
      "placeholder:text-input-placeholder",
      // Focus
      "focus:outline-none focus:border-input-focus-border focus:shadow-[0_0_0_3px_var(--input-focus-ring)]",
      // Disabled
      "disabled:cursor-not-allowed disabled:opacity-60",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export { Textarea };
