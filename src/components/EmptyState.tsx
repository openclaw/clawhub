import type { LucideIcon } from "lucide-react";
import { Package } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./ui/button";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick?: () => void;
    href?: string;
  };
  children?: ReactNode;
}

export function EmptyState({
  icon: Icon = Package,
  title,
  description,
  action,
  children,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-[var(--radius-md)] border border-dashed border-[color:var(--line)] bg-[color:var(--surface)] px-6 py-14 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[color:var(--surface-muted)]">
        <Icon className="h-7 w-7 text-[color:var(--ink-soft)]" />
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-base font-bold text-[color:var(--ink)]">{title}</h3>
        {description && (
          <p className="max-w-sm text-sm text-[color:var(--ink-soft)]">{description}</p>
        )}
      </div>
      {action &&
        (action.href ? (
          <a href={action.href}>
            <Button variant="outline">{action.label}</Button>
          </a>
        ) : (
          <Button variant="outline" onClick={action.onClick}>
            {action.label}
          </Button>
        ))}
      {children}
    </div>
  );
}
