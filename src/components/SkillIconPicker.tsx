import { Check } from "lucide-react";
import { ALLOWED_LUCIDE_ICON_NAMES, ALLOWED_LUCIDE_ICONS } from "../lib/skillIcon";

type SkillIconPickerProps = {
  /** Currently selected lucide name (e.g. `Plug`) or `null` for "no icon". */
  value: string | null;
  onChange: (next: string | null) => void;
};

/**
 * Grid of pre-approved lucide icons for the skill publish form.
 *
 * Phase 1: pure local-state picker. Phase 2 (custom upload) will plug a new
 * tab in here without changing the surrounding form contract.
 */
export function SkillIconPicker({ value, onChange }: SkillIconPickerProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Skill icon">
        <IconButton label="No icon" isSelected={value === null} onSelect={() => onChange(null)}>
          <span className="text-xs font-medium text-[color:var(--ink-soft)]">None</span>
        </IconButton>

        {ALLOWED_LUCIDE_ICON_NAMES.map((name) => {
          const Icon = ALLOWED_LUCIDE_ICONS[name];
          if (!Icon) return null;
          const isSelected = value === name;
          return (
            <IconButton
              key={name}
              label={name}
              isSelected={isSelected}
              onSelect={() => onChange(name)}
            >
              <Icon className="h-5 w-5 text-[color:var(--ink)]" strokeWidth={1.8} />
            </IconButton>
          );
        })}
      </div>
      <p className="text-xs text-[color:var(--ink-soft)]">
        {value
          ? `Selected: ${value}. Click again to change, or pick "None" to use the default icon.`
          : "Optional. Pick an icon shown on the skill card and listings."}
      </p>
    </div>
  );
}

function IconButton({
  label,
  isSelected,
  onSelect,
  children,
}: {
  label: string;
  isSelected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isSelected}
      aria-label={label}
      title={label}
      onClick={onSelect}
      className={[
        "relative flex h-11 w-11 items-center justify-center rounded-[var(--radius-sm)] border transition-all",
        isSelected
          ? "border-[color:var(--accent)] bg-[color:var(--accent)]/10 shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent)_30%,transparent)]"
          : "border-[rgba(29,59,78,0.18)] bg-[rgba(255,255,255,0.94)] hover:border-[color:var(--accent)]/60 dark:border-[rgba(255,255,255,0.12)] dark:bg-[rgba(14,28,37,0.84)]",
      ].join(" ")}
    >
      {children}
      {isSelected ? (
        <Check
          className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-[color:var(--accent)] p-[2px] text-white"
          strokeWidth={3}
        />
      ) : null}
    </button>
  );
}
