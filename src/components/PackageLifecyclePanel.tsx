import type { PackageLifecycle, PackageLifecycleSeverity } from "../lib/packageLifecycle";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

const SEVERITY_BADGE: Record<PackageLifecycleSeverity, "default" | "accent" | "destructive"> = {
  neutral: "default",
  info: "default",
  success: "default",
  warning: "accent",
  danger: "destructive",
};

export function PackageLifecyclePanel(props: {
  lifecycle: PackageLifecycle;
  title?: string;
  compact?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <CardTitle>{props.title ?? "Release lifecycle"}</CardTitle>
        <Badge variant={SEVERITY_BADGE[props.lifecycle.severity]}>{props.lifecycle.label}</Badge>
      </CardHeader>
      <CardContent>
        <p className="m-0 text-sm text-[color:var(--ink-soft)]">{props.lifecycle.description}</p>
        {props.lifecycle.action ? (
          <p className="m-0 mt-2 text-sm font-semibold text-[color:var(--ink)]">
            {props.lifecycle.action}
          </p>
        ) : null}
        <div className="mt-4 grid gap-2 sm:grid-cols-5">
          {props.lifecycle.steps.map((step) => (
            <div
              key={step.key}
              className={`rounded-[var(--radius-sm)] border px-3 py-2 text-xs ${
                step.status === "done"
                  ? "border-emerald-300/50 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-100"
                  : step.status === "active"
                    ? "border-amber-300/50 bg-amber-50 text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-100"
                    : step.status === "blocked"
                      ? "border-red-300/50 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-100"
                      : "border-[color:var(--line)] bg-[color:var(--surface-muted)] text-[color:var(--ink-soft)]"
              }`}
            >
              <span className="block font-semibold text-current">{step.label}</span>
              {!props.compact ? <span className="capitalize">{step.status}</span> : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
