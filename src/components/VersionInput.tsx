import { ChevronDown, ChevronUp } from "lucide-react";
import type * as React from "react";
import semver from "semver";
import { cn } from "../lib/utils";
import { Input } from "./ui/input";

type VersionInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  value: string;
  onValueChange: (value: string) => void;
};

export function VersionInput({
  value,
  onValueChange,
  className,
  disabled,
  ...props
}: VersionInputProps) {
  const baseVersion = getBaseVersion(value);
  const canStepDown = Boolean(baseVersion && baseVersion.patch > 0);

  const stepPatch = (delta: 1 | -1) => {
    const base = getBaseVersion(value) ?? semver.parse("0.0.0");
    if (!base) return;
    const nextPatch = Math.max(0, base.patch + delta);
    onValueChange(`${base.major}.${base.minor}.${nextPatch}`);
  };

  return (
    <div className="relative">
      <Input
        {...props}
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn("pr-12", className)}
      />
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 flex-col">
        <button
          type="button"
          aria-label="Increase patch version"
          className="flex h-5 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--ink-soft)] transition-colors hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--ink)] disabled:pointer-events-none disabled:opacity-40"
          disabled={disabled}
          onClick={() => stepPatch(1)}
        >
          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Decrease patch version"
          className="flex h-5 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--ink-soft)] transition-colors hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--ink)] disabled:pointer-events-none disabled:opacity-40"
          disabled={disabled || !canStepDown}
          onClick={() => stepPatch(-1)}
        >
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function getBaseVersion(value: string) {
  const trimmed = value.trim();
  const valid = semver.valid(trimmed);
  return semver.parse(valid ?? semver.coerce(trimmed)?.version ?? "0.0.0");
}
