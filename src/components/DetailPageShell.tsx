import type { ReactNode } from "react";
import { cn } from "../lib/utils";

type DetailPageShellProps = {
  children: ReactNode;
  className?: string;
};

type DetailHeroProps = {
  main: ReactNode;
  sidebar?: ReactNode;
  children?: ReactNode;
  className?: string;
  topClassName?: string;
  mainClassName?: string;
  sidebarClassName?: string;
};

type DetailBodyProps = {
  children: ReactNode;
  className?: string;
  mainClassName?: string;
};

export function DetailPageShell({ children, className }: DetailPageShellProps) {
  return <div className={cn("skill-detail-stack", className)}>{children}</div>;
}

export function DetailHero({
  main,
  sidebar,
  children,
  className,
  topClassName,
  mainClassName,
  sidebarClassName,
}: DetailHeroProps) {
  return (
    <div className={cn("skill-hero", className)}>
      <div className={cn("skill-hero-top", topClassName)}>
        <div className={cn(sidebar ? "skill-hero-layout has-sidebar" : "skill-hero-layout")}>
          <div className={cn("skill-hero-main", mainClassName)}>
            {main}
            {children ? <div className="skill-hero-main-extra">{children}</div> : null}
          </div>
          {sidebar ? (
            <aside className={cn("skill-hero-sidebar", sidebarClassName)}>{sidebar}</aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function DetailBody({ children, className, mainClassName }: DetailBodyProps) {
  return (
    <div className={cn("detail-layout", className)}>
      <div className={cn("detail-main", mainClassName)}>{children}</div>
    </div>
  );
}
