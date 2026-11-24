import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export const DETAIL_HERO_TOPIC_LIMIT = 4;

type DetailPageShellProps = {
  children: ReactNode;
  className?: string;
};

type DetailBodyProps = {
  children: ReactNode;
  className?: string;
  mainClassName?: string;
};

export function DetailPageShell({ children, className }: DetailPageShellProps) {
  return <div className={cn("skill-detail-stack", className)}>{children}</div>;
}

export function DetailBody({ children, className, mainClassName }: DetailBodyProps) {
  return (
    <div className={cn("detail-layout", className)}>
      <div className={cn("detail-main", mainClassName)}>{children}</div>
    </div>
  );
}
