import { Info, Lightbulb, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "../lib/utils";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

export const SKILL_PUBLISH_SUMMARY_MAX_LENGTH = 300;

const BANNER_TEXTAREA_GAP_PX = 24;

type SkillShortSummaryFieldProps = {
  id: string;
  value: string;
  disabled?: boolean;
  recommendation?: boolean;
  onDismissRecommendation?: () => void;
  onChange: (value: string) => void;
};

export function SkillShortSummaryField({
  id,
  value,
  disabled,
  recommendation,
  onDismissRecommendation,
  onChange,
}: SkillShortSummaryFieldProps) {
  const bannerRef = useRef<HTMLDivElement>(null);
  const [bannerHeight, setBannerHeight] = useState(0);

  useLayoutEffect(() => {
    let disconnect: (() => void) | undefined;

    if (!recommendation) {
      setBannerHeight(0);
    } else {
      const node = bannerRef.current;
      if (node) {
        const updateHeight = () => {
          setBannerHeight(node.getBoundingClientRect().height);
        };
        updateHeight();
        if (typeof ResizeObserver !== "undefined") {
          const observer = new ResizeObserver(updateHeight);
          observer.observe(node);
          disconnect = () => observer.disconnect();
        }
      }
    }

    return () => {
      disconnect?.();
    };
  }, [recommendation]);

  const textareaPaddingBottom =
    recommendation && bannerHeight > 0 ? bannerHeight + BANNER_TEXTAREA_GAP_PX : undefined;

  return (
    <div className="flex flex-col gap-3 col-span-full">
      <Label htmlFor={id}>Short summary</Label>
      <div
        className={cn(
          "relative",
          recommendation &&
            "overflow-hidden rounded-[var(--radius-sm)] border border-input-border transition-all duration-[180ms] ease-out focus-within:border-input-focus-border focus-within:shadow-[0_0_0_3px_var(--input-focus-ring)]",
        )}
      >
        <Textarea
          id={id}
          aria-label="Short summary"
          rows={3}
          value={value}
          maxLength={SKILL_PUBLISH_SUMMARY_MAX_LENGTH}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Enter a brief description..."
          className={cn(
            recommendation &&
              "rounded-none border-0 shadow-none focus:border-transparent focus:shadow-none",
          )}
          style={
            textareaPaddingBottom !== undefined
              ? { paddingBottom: textareaPaddingBottom }
              : undefined
          }
        />
        {recommendation ? (
          <div
            ref={bannerRef}
            className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-[color:var(--line)] bg-[color:var(--surface-muted)] px-3.5 py-2.5"
            role="note"
          >
            <div className="flex flex-col gap-2">
              <div className="flex w-full items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5 font-semibold leading-none text-[#0099ff]">
                  <Lightbulb className="size-3.5 shrink-0" aria-hidden />
                  <span>Make it discoverable!</span>
                </div>
                <button
                  type="button"
                  aria-label="Dismiss summary recommendation"
                  disabled={disabled}
                  className="pointer-events-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--ink-soft)] transition-colors hover:text-[color:var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={onDismissRecommendation}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
              <p className="text-xs leading-relaxed text-[color:var(--ink-soft)]">
                Imported from your SKILL.md. Descriptions there are often written for agents —
                technical and trigger-focused. On ClawHub, this appears in cards and search, where
                people decide whether to try your skill.
              </p>
              <div className="flex flex-col gap-1 text-xs leading-snug sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-1">
                <span className="font-semibold text-[color:var(--ink)]">For better discovery</span>
                <span
                  className="hidden h-3 w-px shrink-0 bg-[color:var(--line)] sm:block"
                  aria-hidden
                />
                <span className="font-medium text-[color:var(--ink)]">
                  Say what it does · Name who it&apos;s for · Keep it short and jargon-light
                </span>
              </div>
              <p className="mt-2 flex items-start gap-1.5 border-t border-[color:var(--line)]/50 pt-2 text-xs leading-snug text-[color:var(--ink-soft)]">
                <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
                <span>Edits here only affect ClawHub, not your SKILL.md.</span>
              </p>
            </div>
          </div>
        ) : null}
      </div>
      <span className="self-end text-xs text-[color:var(--ink-soft)]">
        {value.trim().length}/{SKILL_PUBLISH_SUMMARY_MAX_LENGTH}
      </span>
    </div>
  );
}
