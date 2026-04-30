import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

type CopyState = "idle" | "copied" | "failed";

export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

export function InstallCopyButton({
  text,
  label = "Copy",
  ariaLabel,
  className,
  showLabel = true,
}: {
  text: string;
  label?: string;
  ariaLabel?: string;
  className?: string;
  showLabel?: boolean;
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

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={cn("skill-install-copy-button", className)}
      aria-label={ariaLabel ?? label}
      data-copy-state={copyState}
      onClick={() => {
        void copyText(text)
          .then((didCopy) => {
            setCopyState(didCopy ? "copied" : "failed");
            scheduleReset();
          })
          .catch(() => {
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
}
