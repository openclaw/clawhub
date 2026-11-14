import { Code2, FileText, Package, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { useRef } from "react";
import { cn } from "../lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import type { usePublishDialog } from "./usePublishDialog";

export function PublishDialogFrame({
  open,
  onDismiss,
  title,
  description,
  className,
  children,
}: {
  open: boolean;
  onDismiss: ReturnType<typeof usePublishDialog>["dismiss"];
  title: ReactNode;
  description: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const dialogContentRef = useRef<HTMLDivElement | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onDismiss();
      }}
    >
      <DialogContent
        ref={dialogContentRef}
        tabIndex={-1}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          dialogContentRef.current?.focus({ preventScroll: true });
        }}
        onEscapeKeyDown={() => onDismiss("escape")}
        onInteractOutside={() => onDismiss("outside")}
        className={cn(
          "[--publish-accent:var(--oc-status-success-fg)] [display:block] w-[min(calc(100vw-2rem),620px)] overflow-hidden rounded-[var(--oc-radius-surface)] border-[color:var(--oc-border-subtle)] bg-[color:var(--oc-bg-elevated)] p-0 shadow-[var(--oc-shadow-lg)] focus:outline-none sm:p-0",
          className,
        )}
        style={{ display: "block" }}
      >
        <div className="relative w-full overflow-hidden">
          <div
            className="pointer-events-none absolute inset-x-[9%] top-0 z-20 h-px bg-[linear-gradient(90deg,transparent_0%,color-mix(in_srgb,var(--publish-accent)_28%,transparent)_20%,color-mix(in_srgb,var(--publish-accent)_72%,transparent)_50%,color-mix(in_srgb,var(--publish-accent)_28%,transparent)_80%,transparent_100%)]"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-[radial-gradient(70%_72%_at_50%_0%,color-mix(in_srgb,var(--publish-accent)_11%,transparent)_0%,color-mix(in_srgb,var(--publish-accent)_5%,transparent)_42%,transparent_82%)]"
            aria-hidden="true"
          />

          <div className="relative flex flex-col gap-4 p-5 pt-6 pb-5 sm:p-7 sm:pt-8 sm:pb-6">
            <div className="relative overflow-hidden rounded-[var(--radius-md)] px-6 py-5 text-center sm:px-10">
              <div
                className="pointer-events-none absolute inset-0 hidden overflow-hidden rounded-[inherit] text-[color:var(--ink-soft)] sm:block"
                aria-hidden="true"
              >
                <FileText
                  className="absolute left-[9%] top-[22%] h-5 w-5 -rotate-12 opacity-18"
                  strokeWidth={1.8}
                />
                <Code2
                  className="absolute left-[16%] bottom-[20%] h-5 w-5 rotate-8 opacity-14"
                  strokeWidth={1.8}
                />
                <Wrench
                  className="absolute right-[10%] top-[23%] h-5 w-5 rotate-12 opacity-16"
                  strokeWidth={1.8}
                />
                <Package
                  className="absolute right-[16%] bottom-[20%] h-5 w-5 -rotate-10 opacity-14"
                  strokeWidth={1.8}
                />
              </div>
              <div className="relative">
                <DialogTitle className="inline-flex items-center justify-center gap-2 text-[1.35rem] leading-tight sm:text-[1.45rem]">
                  {title}
                </DialogTitle>
                <DialogDescription className="mx-auto mt-1.5 max-w-[31rem] text-[0.8125rem] leading-[1.4] [text-wrap:balance]">
                  {description}
                </DialogDescription>
              </div>
            </div>

            {children}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PublishDialogPublisher({
  publisher,
}: {
  publisher?: { displayName?: string | null; handle?: string | null } | null;
}) {
  const publisherDisplayName = publisher?.displayName?.trim() || null;
  const publisherHandle = publisher?.handle?.trim() || null;
  const publisherLabel = publisherDisplayName || (publisherHandle ? "@" + publisherHandle : null);
  return publisherLabel ? (
    <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-[color:var(--ink-soft)]">
      <span className="min-w-0 truncate font-medium">{publisherLabel}</span>
      {publisherDisplayName && publisherHandle ? (
        <>
          <span
            className="shrink-0 leading-none text-[color:color-mix(in_srgb,var(--ink-soft)_66%,var(--surface))]"
            aria-hidden="true"
          >
            ·
          </span>
          <span className="shrink-0 text-[color:color-mix(in_srgb,var(--ink-soft)_82%,var(--surface))]">
            @{publisherHandle}
          </span>
        </>
      ) : null}
    </div>
  ) : null;
}

export function PublishDialogLink({ linkUrl, children }: { linkUrl: string; children: ReactNode }) {
  return (
    <div className="-mt-2 flex min-w-0 items-center gap-2 rounded-b-[var(--oc-radius-surface)] border border-t-0 border-[color:color-mix(in_srgb,var(--oc-border-subtle)_74%,transparent)] bg-[color:var(--oc-bg-surface)] px-3.5 pb-2 pt-4">
      <div
        className="h-2 w-2 shrink-0 rounded-full bg-[color:color-mix(in_srgb,var(--publish-accent)_42%,transparent)]"
        aria-hidden="true"
      />
      <a
        href={linkUrl}
        target="_blank"
        rel="noreferrer"
        className="block min-w-0 flex-1 truncate text-xs font-medium text-[color:color-mix(in_srgb,var(--ink-soft)_68%,var(--surface))] !no-underline hover:!no-underline hover:text-[color:var(--ink-soft)]"
      >
        {linkUrl.replace(/^https?:\/\//, "")}
      </a>
      {children}
    </div>
  );
}
