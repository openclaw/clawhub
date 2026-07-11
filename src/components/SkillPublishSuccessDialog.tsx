import {
  ArrowRight,
  Check,
  Code2,
  Copy,
  ExternalLink,
  FileText,
  Package,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getClawHubSiteUrl } from "../lib/site";
import { cn } from "../lib/utils";
import { copyText } from "./InstallCopyButton";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

export const OPENCLAW_SKILLS_DISCORD_URL =
  "https://discord.com/channels/1456350064065904867/1456891440897724637";
const PUBLIC_CLAWHUB_SITE_URL = "https://clawhub.ai";
const LOCAL_SHARE_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

type CopyState = "idle" | "copied" | "failed";

type SkillPublishSuccessDialogProps = {
  isOpen: boolean;
  displayName: string;
  skillPath: string;
  skill?: {
    categories?: readonly string[] | null;
    inferredCategories?: readonly string[] | null;
    latestVersionId?: string | null;
    inferredFromVersionId?: string | null;
    slug: string;
    displayName: string;
    summary?: string | null;
    icon?: string | null;
  } | null;
  publisher?: {
    displayName?: string | null;
    handle?: string | null;
    image?: string | null;
    kind?: string | null;
  } | null;
  categoryLabel?: string | null;
  onDismiss: () => void;
};

function getPublicClawHubSiteUrl() {
  const configured = getClawHubSiteUrl();
  try {
    const hostname = new URL(configured).hostname;
    if (LOCAL_SHARE_HOSTS.has(hostname)) return PUBLIC_CLAWHUB_SITE_URL;
  } catch {
    return PUBLIC_CLAWHUB_SITE_URL;
  }
  return configured;
}

function buildAbsoluteSkillUrl(skillPath: string) {
  return new URL(skillPath, getPublicClawHubSiteUrl()).toString();
}

function buildXShareUrl(displayName: string, skillUrl: string) {
  const params = new URLSearchParams({
    text: `${displayName} is now live on ClawHub 🦞 Check it out: ${skillUrl}`,
  });
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

function buildDiscordShareText(displayName: string, skillUrl: string) {
  return `I just published ${displayName} on ClawHub: ${skillUrl}`;
}

export function SkillPublishSuccessDialog({
  isOpen,
  displayName,
  skillPath,
  skill,
  publisher,
  categoryLabel,
  onDismiss,
}: SkillPublishSuccessDialogProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [dismissed, setDismissed] = useState(false);
  const hasDismissedRef = useRef(false);
  const dialogContentRef = useRef<HTMLDivElement | null>(null);
  const skillUrl = useMemo(() => buildAbsoluteSkillUrl(skillPath), [skillPath]);
  const compactSkillUrl = useMemo(() => skillUrl.replace(/^https?:\/\//, ""), [skillUrl]);
  const xShareUrl = useMemo(() => buildXShareUrl(displayName, skillUrl), [displayName, skillUrl]);
  const discordShareText = useMemo(
    () => buildDiscordShareText(displayName, skillUrl),
    [displayName, skillUrl],
  );
  const publisherDisplayName = publisher?.displayName?.trim() || null;
  const publisherHandle = publisher?.handle?.trim() || null;
  const publisherLabel = publisherDisplayName || (publisherHandle ? `@${publisherHandle}` : null);

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

  async function copySkillLink() {
    try {
      const didCopy = await copyText(skillUrl);
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
        onEscapeKeyDown={() => {
          dismiss();
        }}
        onInteractOutside={() => {
          dismiss();
        }}
        className="[--discord-accent:#5865F2] [--publish-accent:var(--oc-status-success-fg)] [display:block] w-[min(calc(100vw-2rem),620px)] overflow-hidden rounded-[var(--oc-radius-surface)] border-[color:var(--oc-border-subtle)] bg-[color:var(--oc-bg-elevated)] p-0 shadow-[var(--oc-shadow-lg)] focus:outline-none sm:p-0"
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
                  <span>It's alive!</span>
                  <span className="text-[1.35rem] leading-none" aria-hidden="true">
                    🦞
                  </span>
                </DialogTitle>
                <DialogDescription className="mx-auto mt-1.5 max-w-[31rem] text-[0.8125rem] leading-[1.4] [text-wrap:balance]">
                  Give your skill a first boost in the OpenClaw community or share it with your
                  network.
                </DialogDescription>
              </div>
            </div>

            <div>
              <div className="relative z-10 rounded-t-[var(--radius-md)] rounded-b-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:color-mix(in_srgb,var(--surface-muted)_78%,var(--surface))] px-3.5 pb-3.5 pt-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <MarketplaceIcon
                    kind="skill"
                    label={displayName}
                    icon={skill?.icon}
                    skill={skill}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="truncate text-[0.8125rem] font-bold text-[color:var(--ink)]">
                          {displayName}
                        </p>
                      </div>
                      {categoryLabel ? (
                        <span className="hidden shrink-0 self-center text-[0.6875rem] font-medium leading-none text-[color:color-mix(in_srgb,var(--ink-soft)_74%,var(--surface))] sm:inline">
                          {categoryLabel}
                        </span>
                      ) : null}
                    </div>
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
                  href={skillUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block min-w-0 flex-1 truncate text-xs font-medium text-[color:color-mix(in_srgb,var(--ink-soft)_68%,var(--surface))] !no-underline hover:!no-underline hover:text-[color:var(--ink-soft)]"
                >
                  {compactSkillUrl}
                </a>
                <button
                  type="button"
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-xs font-semibold text-[color:var(--ink-soft)] transition hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--publish-accent)]/30"
                  aria-label={copyState === "copied" ? "Copied link" : "Copy skill link"}
                  onClick={() => void copySkillLink()}
                >
                  {copyState === "copied" ? (
                    <>
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      Copy link
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="skill-publish-share-list" aria-label="Share destinations">
              <ShareListAction
                href={OPENCLAW_SKILLS_DISCORD_URL}
                title="Share on Discord"
                mobileTitle="Share with the OpenClaw community"
                channelName="#skills"
                serverName="Friends of the Crustacean 🦞🤝"
                onClick={() => {
                  void copyText(discordShareText);
                }}
                icon={<DiscordIcon className="h-3.5 w-3.5 text-white" aria-hidden="true" />}
              />
              <ShareDivider orientation="horizontal" />
              <ShareListAction
                href={xShareUrl}
                title="Share on Twitter"
                icon={<XIcon className="h-3.5 w-3.5" aria-hidden="true" />}
              />
            </div>

            <div className="mt-2 flex justify-end">
              <Button
                type="button"
                className="min-h-0 border-transparent bg-transparent p-0 text-[color:var(--ink-soft)] hover:not-disabled:border-transparent hover:not-disabled:bg-transparent hover:not-disabled:text-[color:var(--ink)]"
                onClick={dismiss}
              >
                View skill
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DiscordIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      <title>Discord</title>
      <path
        fill="currentColor"
        d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"
      />
    </svg>
  );
}

function XIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      <title>X</title>
      <path
        fill="currentColor"
        d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"
      />
    </svg>
  );
}

function ShareDivider({ orientation = "vertical" }: { orientation?: "horizontal" | "vertical" }) {
  return (
    <span
      className={cn(
        "shrink-0 bg-[color:color-mix(in_srgb,var(--line)_82%,transparent)]",
        orientation === "horizontal" ? "h-px w-full" : "h-4 w-px",
      )}
      aria-hidden="true"
    />
  );
}

function ShareListAction({
  href,
  title,
  mobileTitle,
  detail,
  inlineDetail,
  channelName,
  serverName,
  onClick,
  icon,
}: {
  href: string;
  title: string;
  mobileTitle?: string;
  detail?: string;
  inlineDetail?: string;
  channelName?: string;
  serverName?: string;
  onClick?: () => void;
  icon: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={onClick}
      className="group flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-[var(--radius-sm)] px-2 py-1 text-[0.8125rem] font-medium text-[color:var(--ink-soft)] !no-underline transition hover:bg-[color:color-mix(in_srgb,var(--surface-muted)_56%,transparent)] hover:text-[color:var(--ink)] hover:!no-underline focus-visible:!no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--publish-accent)]/30 [&_*]:!no-underline"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {icon}
        {mobileTitle ? (
          <>
            <span className="hidden min-w-0 truncate sm:inline">{title}</span>
            <span className="min-w-0 truncate sm:hidden">{mobileTitle}</span>
          </>
        ) : (
          <span className="min-w-0 truncate">{title}</span>
        )}
        {inlineDetail ? (
          <>
            <span
              className="hidden w-3 shrink-0 justify-center text-[color:color-mix(in_srgb,var(--ink-soft)_56%,var(--surface))] sm:inline-flex"
              aria-hidden="true"
            >
              ·
            </span>
            <span className="hidden min-w-0 truncate text-xs font-medium text-[color:color-mix(in_srgb,var(--ink-soft)_76%,var(--surface))] sm:block">
              {inlineDetail}
            </span>
          </>
        ) : null}
        {channelName ? (
          <>
            <span
              className="hidden w-3 shrink-0 justify-center text-[color:color-mix(in_srgb,var(--ink-soft)_56%,var(--surface))] sm:inline-flex"
              aria-hidden="true"
            >
              ·
            </span>
            <span className="hidden min-w-0 truncate text-xs font-bold text-[color:color-mix(in_srgb,var(--ink-soft)_86%,var(--surface))] sm:block">
              {channelName}
            </span>
            {serverName ? (
              <>
                <span className="hidden shrink-0 text-xs font-medium text-[color:color-mix(in_srgb,var(--ink-soft)_58%,var(--surface))] sm:block">
                  /
                </span>
                <span className="hidden min-w-0 truncate text-xs font-medium text-[color:color-mix(in_srgb,var(--ink-soft)_76%,var(--surface))] sm:block">
                  {serverName}
                </span>
              </>
            ) : null}
          </>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-[color:color-mix(in_srgb,var(--ink-soft)_76%,var(--surface))]">
        {detail ? <span className="hidden text-xs font-medium sm:inline">{detail}</span> : null}
        <ExternalLink className="h-3 w-3 shrink-0 opacity-55 transition group-hover:opacity-100" />
      </span>
    </a>
  );
}
