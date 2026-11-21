import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { captureAnalyticsOperation } from "../lib/analyticsEvents";
import { copyText } from "../lib/clipboard";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

type CopyState = "idle" | "copied" | "failed";

export function InstallCopyButton({
  text,
  label = "Copy",
  ariaLabel,
  title,
  tooltip,
  className,
  showLabel = true,
  variant = "outline",
  size = "sm",
  analyticsMethod,
}: {
  text: string;
  label?: string;
  ariaLabel?: string;
  title?: string;
  tooltip?: string;
  className?: string;
  showLabel?: boolean;
  variant?: "default" | "primary" | "secondary" | "destructive" | "ghost" | "outline" | "link";
  size?: "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";
  analyticsMethod?: "cli" | "skills" | "prompt" | "link";
}) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current);
      }
    },
    [],
  );

  const scheduleReset = () => {
    if (resetTimeoutRef.current !== null) {
      window.clearTimeout(resetTimeoutRef.current);
    }

    resetTimeoutRef.current = window.setTimeout(() => {
      setCopyState("idle");
      resetTimeoutRef.current = null;
    }, 2000);
  };

  const buttonLabel =
    copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy Failed" : label;

  const button = (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={cn("skill-install-copy-button", className)}
      aria-label={ariaLabel ?? label}
      title={tooltip ? undefined : title}
      data-copy-state={copyState}
      onClick={() => {
        const operation = captureAnalyticsOperation();
        void copyText(text)
          .then((didCopy) => {
            operation?.emit("copy_action", {
              content_type: "install",
              action_result: didCopy ? "success" : "error",
              ui_location: "install",
              method: analyticsMethod,
            });
            setCopyState(didCopy ? "copied" : "failed");
            scheduleReset();
          })
          .catch(() => {
            operation?.emit("copy_action", {
              content_type: "install",
              action_result: "error",
              ui_location: "install",
              method: analyticsMethod,
            });
            setCopyState("failed");
            scheduleReset();
          });
      }}
    >
      {copyState === "copied" ? (
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {showLabel ? <span aria-live="polite">{buttonLabel}</span> : null}
    </Button>
  );

  if (!tooltip) {
    return button;
  }

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="top" align="end">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
