import { Lightbulb, X } from "lucide-react";
import { cn } from "../lib/utils";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

export const SKILL_PUBLISH_SUMMARY_MAX_LENGTH = 300;

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
  const countLabel = `${value.trim().length}/${SKILL_PUBLISH_SUMMARY_MAX_LENGTH}`;

  return (
    <div className="flex flex-col gap-3 col-span-full">
      <Label htmlFor={id}>Summary</Label>
      <Textarea
        id={id}
        aria-label="Summary"
        rows={3}
        value={value}
        maxLength={SKILL_PUBLISH_SUMMARY_MAX_LENGTH}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Enter a brief description..."
      />
      <div className="flex items-center justify-end gap-3">
        {recommendation ? (
          <div
            className="mr-auto flex min-w-0 items-center gap-1.5 text-xs leading-snug text-[color:var(--ink-soft)]"
            role="note"
          >
            <Lightbulb className="size-3.5 shrink-0 text-[#0099ff]" aria-hidden />
            <span className="min-w-0">
              <span className="font-semibold text-[#0099ff]">Pulled from your SKILL.md.</span> This
              is what people see in cards and search.
            </span>
            <button
              type="button"
              aria-label="Dismiss summary recommendation"
              disabled={disabled}
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--ink-soft)] transition-colors hover:text-[color:var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35",
                disabled && "cursor-not-allowed opacity-50",
              )}
              onClick={onDismissRecommendation}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        ) : null}
        <span className="shrink-0 text-xs text-[color:var(--ink-soft)]">{countLabel}</span>
      </div>
    </div>
  );
}
