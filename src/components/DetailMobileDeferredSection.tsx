import { useState, useSyncExternalStore, type ReactNode, type SyntheticEvent } from "react";
import { cn } from "../lib/utils";

export const DESKTOP_DETAIL_BREAKPOINT = "(min-width: 901px)";

function getDesktopDetailLayoutMediaQuery() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(DESKTOP_DETAIL_BREAKPOINT);
}

function subscribeDesktopDetailLayout(onStoreChange: () => void) {
  const mediaQuery = getDesktopDetailLayoutMediaQuery();
  if (!mediaQuery) return () => undefined;

  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getDesktopDetailLayoutSnapshot() {
  if (typeof window === "undefined") return false;
  return getDesktopDetailLayoutMediaQuery()?.matches ?? true;
}

export function useIsDesktopDetailLayout() {
  return useSyncExternalStore(
    subscribeDesktopDetailLayout,
    getDesktopDetailLayoutSnapshot,
    () => false,
  );
}

export function DetailMobileDeferredSection({
  summary = "Details",
  children,
  className,
}: {
  summary?: string;
  children: ReactNode;
  className?: string;
}) {
  const isDesktop = useIsDesktopDetailLayout();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (!isDesktop) {
      setMobileOpen(event.currentTarget.open);
    }
  };

  if (isDesktop) {
    return (
      <div className={cn("detail-mobile-deferred", "detail-mobile-deferred-desktop", className)}>
        {children}
      </div>
    );
  }

  return (
    <details
      className={cn("detail-mobile-deferred", className)}
      open={mobileOpen}
      onToggle={handleToggle}
    >
      <summary className="detail-mobile-deferred-summary">{summary}</summary>
      <div className="detail-mobile-deferred-body">{children}</div>
    </details>
  );
}
