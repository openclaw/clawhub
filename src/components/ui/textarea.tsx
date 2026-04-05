import * as React from "react";
import { cn } from "../../lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      // Base styles matching .form-input
      "w-full min-h-[100px] resize-y rounded-[var(--radius-sm)] border px-3.5 py-[13px] text-[color:var(--ink)] transition-all duration-[180ms] ease-out",
      "border-[rgba(29,59,78,0.22)] bg-[rgba(255,255,255,0.94)]",
      "placeholder:text-[rgba(88,115,133,0.72)]",
      // Focus
      "focus:outline-none focus:border-[color-mix(in_srgb,var(--accent)_70%,white)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)]",
      // Dark mode
      "dark:border-[rgba(255,255,255,0.12)] dark:bg-[rgba(14,28,37,0.84)]",
      "dark:placeholder:text-[rgba(184,205,216,0.68)]",
      "dark:focus:border-[rgba(255,131,95,0.75)] dark:focus:shadow-[0_0_0_3px_rgba(255,131,95,0.2)]",
      // Disabled
      "disabled:cursor-not-allowed disabled:opacity-60",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export { Textarea };
