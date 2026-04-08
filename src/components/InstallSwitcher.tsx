import { useMemo, useState } from "react";

type PackageManager = "npm" | "pnpm" | "bun";

type InstallSwitcherProps = {
  exampleSlug?: string;
};

const PACKAGE_MANAGERS: Array<{ id: PackageManager; label: string }> = [
  { id: "npm", label: "npm" },
  { id: "pnpm", label: "pnpm" },
  { id: "bun", label: "bun" },
];

export function InstallSwitcher({ exampleSlug = "sonoscli" }: InstallSwitcherProps) {
  const [pm, setPm] = useState<PackageManager>("npm");

  const command = useMemo(() => {
    switch (pm) {
      case "npm":
        return `npx clawhub@latest install ${exampleSlug}`;
      case "pnpm":
        return `pnpm dlx clawhub@latest install ${exampleSlug}`;
      case "bun":
        return `bunx clawhub@latest install ${exampleSlug}`;
    }
  }, [exampleSlug, pm]);

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-[color:var(--ink-soft)]">
          Install any skill folder in one shot:
        </div>
        <div
          className="inline-flex items-center gap-0.5 rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] p-[3px]"
          role="tablist"
          aria-label="Install command"
        >
          {PACKAGE_MANAGERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`cursor-pointer rounded-full border-none px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                pm === entry.id
                  ? "bg-[color:var(--accent)] text-white shadow-sm"
                  : "bg-transparent text-[color:var(--ink-soft)] hover:text-[color:var(--ink)]"
              }`}
              role="tab"
              aria-selected={pm === entry.id}
              onClick={() => setPm(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-[var(--radius-sm)] bg-[color:var(--surface)] p-3 font-mono text-xs">
        {command}
      </div>
    </div>
  );
}
