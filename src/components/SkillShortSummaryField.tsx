import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

export const SKILL_PUBLISH_SUMMARY_MAX_LENGTH = 200;

type SkillShortSummaryFieldProps = {
  id: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

export function SkillShortSummaryField({
  id,
  value,
  disabled,
  onChange,
}: SkillShortSummaryFieldProps) {
  return (
    <div className="flex flex-col gap-2 col-span-full">
      <Label htmlFor={id}>Short summary</Label>
      <p className="text-sm text-[color:var(--ink-soft)]">
        Short description shown in cards, search, and previews.
      </p>
      <Textarea
        id={id}
        aria-label="Short summary"
        rows={3}
        value={value}
        maxLength={SKILL_PUBLISH_SUMMARY_MAX_LENGTH}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Enter a brief description..."
      />
      <span className="text-xs text-[color:var(--ink-soft)]">
        {value.trim().length}/{SKILL_PUBLISH_SUMMARY_MAX_LENGTH}
      </span>
    </div>
  );
}
