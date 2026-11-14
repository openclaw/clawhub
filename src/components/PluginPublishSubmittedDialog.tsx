import { ArrowRight, Check, Copy } from "lucide-react";
import { useMemo } from "react";
import { getPublicClawHubSiteUrl } from "../lib/site";
import { MarketplaceIcon } from "./MarketplaceIcon";
import {
  PublishDialogFrame,
  PublishDialogLink,
  PublishDialogPublisher,
} from "./PublishDialogParts";
import { Button } from "./ui/button";
import { usePublishDialog } from "./usePublishDialog";

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
  const pluginUrl = useMemo(() => buildAbsolutePluginUrl(pluginPath), [pluginPath]);
  const {
    copyState,
    dismissed,
    dismiss,
    copyLink: copyPluginLink,
  } = usePublishDialog({
    isOpen,
    popupId: "plugin_submitted",
    linkUrl: pluginUrl,
    onDismiss,
  });
  const copyButtonLabel =
    copyState === "copied"
      ? "Copied plugin link"
      : copyState === "failed"
        ? "Plugin link copy failed"
        : "Copy plugin link";
  const copyButtonText =
    copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy link";
  const CopyButtonIcon = copyState === "copied" ? Check : Copy;

  return (
    <PublishDialogFrame
      open={isOpen && !dismissed}
      onDismiss={dismiss}
      title="Plugin submitted"
      description="Your plugin is under review"
    >
      <div>
        <div className="relative z-10 rounded-t-[var(--radius-md)] rounded-b-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:color-mix(in_srgb,var(--surface-muted)_78%,var(--surface))] px-3.5 pb-3.5 pt-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <MarketplaceIcon kind="plugin" label={pluginName} tone="muted" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.8125rem] font-bold text-[color:var(--ink)]">
                {pluginName}
              </p>
              <PublishDialogPublisher publisher={publisher} />
            </div>
          </div>
        </div>

        <PublishDialogLink linkUrl={pluginUrl}>
          <button
            type="button"
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-xs font-semibold text-[color:var(--ink-soft)] transition hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--publish-accent)]/30"
            aria-label={copyButtonLabel}
            onClick={() => void copyPluginLink()}
          >
            <CopyButtonIcon className="h-3.5 w-3.5" aria-hidden="true" />
            <span aria-live="polite">{copyButtonText}</span>
          </button>
        </PublishDialogLink>
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
    </PublishDialogFrame>
  );
}
