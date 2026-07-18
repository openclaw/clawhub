import { ArrowRight, Check, Code2, Copy, FileText, Package, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getPublicClawHubSiteUrl } from "../lib/site";
import { copyText } from "./InstallCopyButton";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

type CopyState = "idle" | "copied" | "failed";

export type SubmittedPlugin = {
  name: string;
  path: string;
  publisher: {
    displayName?: string | null;
    handle?: string | null;
  } | null;
};

type PluginPublishSubmittedDialogProps = {
  isOpen: boolean;
  plugin: SubmittedPlugin;
  onDismiss: () => void;
};

function buildAbsolutePluginUrl(pluginPath: string) {
  return new URL(pluginPath, getPublicClawHubSiteUrl()).toString();
}

export function PluginPublishSubmittedDialog({
  isOpen,
  plugin,
  onDismiss,
}: PluginPublishSubmittedDialogProps) {
  const { name: pluginName, path: pluginPath, publisher } = plugin;
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [dismissed, setDismissed] = useState(false);
  const hasDismissedRef = useRef(false);
  const dialogContentRef = useRef<HTMLDivElement | null>(null);
  const pluginUrl = useMemo(() => buildAbsolutePluginUrl(pluginPath), [pluginPath]);
  const compactPluginUrl = useMemo(() => pluginUrl.replace(/^https?:\/\//, ""), [pluginUrl]);
  const publisherDisplayName = publisher?.displayName?.trim() || null;
  const publisherHandle = publisher?.handle?.trim() || null;
  const publisherLabel = publisherDisplayName || (publisherHandle ? `@${publisherHandle}` : null);
  const copyButtonLabel =
    copyState === "copied"
      ? "Copied plugin link"
      : copyState === "failed"
        ? "Plugin link copy failed"
        : "Copy plugin link";
  const copyButtonText =
    copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy link";
  const CopyButtonIcon = copyState === "copied" ? Check : Copy;

  useEffect(() => {
    if (isOpen) {
      setCopyState("idle");
      setDismissed(false);
      hasDismissedRef.current = false;
    }
  }, [isOpen]);

  function dismiss() {
    if (hasDismissedRef.current) return;
    hasDismissedRef.current = true;
    setDismissed(true);
    onDismiss();
  }

  async function copyPluginLink() {
    try {
      const didCopy = await copyText(pluginUrl);
      setCopyState(didCopy ? "copied" : "failed");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <Dialog
      open={isOpen && !dismissed}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <DialogContent
        ref={dialogContentRef}
        tabIndex={-1}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          dialogContentRef.current?.focus({ preventScroll: true });
        }}
        onEscapeKeyDown={dismiss}
        onInteractOutside={dismiss}
        className="[--publish-accent:var(--oc-status-success-fg)] [display:block] w-[min(calc(100vw-2rem),620px)] overflow-hidden rounded-[var(--oc-radius-surface)] border-[color:var(--oc-border-subtle)] bg-[color:var(--oc-bg-elevated)] p-0 shadow-[var(--oc-shadow-lg)] focus:outline-none sm:p-0"
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
                  Plugin submitted
                </DialogTitle>
                <DialogDescription className="mx-auto mt-1.5 max-w-[31rem] text-[0.8125rem] leading-[1.4] [text-wrap:balance]">
                  Your plugin is under review
                </DialogDescription>
              </div>
            </div>

            <div>
              <div className="relative z-10 rounded-t-[var(--radius-md)] rounded-b-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:color-mix(in_srgb,var(--surface-muted)_78%,var(--surface))] px-3.5 pb-3.5 pt-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <MarketplaceIcon kind="plugin" label={pluginName} tone="muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.8125rem] font-bold text-[color:var(--ink)]">
                      {pluginName}
                    </p>
                    {publisherLabel ? (
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
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="-mt-2 flex min-w-0 items-center gap-2 rounded-b-[var(--oc-radius-surface)] border border-t-0 border-[color:color-mix(in_srgb,var(--oc-border-subtle)_74%,transparent)] bg-[color:var(--oc-bg-surface)] px-3.5 pb-2 pt-4">
                <div
                  className="h-2 w-2 shrink-0 rounded-full bg-[color:color-mix(in_srgb,var(--publish-accent)_42%,transparent)]"
                  aria-hidden="true"
                />
                <a
                  href={pluginUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block min-w-0 flex-1 truncate text-xs font-medium text-[color:color-mix(in_srgb,var(--ink-soft)_68%,var(--surface))] !no-underline hover:!no-underline hover:text-[color:var(--ink-soft)]"
                >
                  {compactPluginUrl}
                </a>
                <button
                  type="button"
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-xs font-semibold text-[color:var(--ink-soft)] transition hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--publish-accent)]/30"
                  aria-label={copyButtonLabel}
                  onClick={() => void copyPluginLink()}
                >
                  <CopyButtonIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span aria-live="polite">{copyButtonText}</span>
                </button>
              </div>
            </div>

            <div className="mt-2 flex justify-end">
              <Button
                asChild
                className="min-h-0 border-transparent bg-transparent p-0 text-[color:var(--ink-soft)] hover:not-disabled:border-transparent hover:not-disabled:bg-transparent hover:not-disabled:text-[color:var(--ink)]"
              >
                <a href={pluginPath}>
                  View plugin
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </a>
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
