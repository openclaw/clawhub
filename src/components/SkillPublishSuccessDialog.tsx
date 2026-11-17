import { ArrowRight, Check, Copy, ExternalLink } from "lucide-react";
import type { MouseEventHandler, ReactNode } from "react";
import { useMemo } from "react";
import {
  analyticsExternalLinkParameters,
  captureAnalyticsOperation,
  emitAnalytics,
} from "../lib/analyticsEvents";
import { getPublicClawHubSiteUrl } from "../lib/site";
import { XIcon } from "./BrandIcons";
import { copyText } from "./InstallCopyButton";
import { MarketplaceIcon } from "./MarketplaceIcon";
import {
  PublishDialogFrame,
  PublishDialogLink,
  PublishDialogPublisher,
} from "./PublishDialogParts";
import { Button } from "./ui/button";
import { usePublishDialog } from "./usePublishDialog";

export const OPENCLAW_SKILLS_DISCORD_URL =
  "https://discord.com/channels/1456350064065904867/1456891440897724637";

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
  const skillUrl = useMemo(() => buildAbsoluteSkillUrl(skillPath), [skillPath]);
  const {
    copyState,
    dismissed,
    dismiss,
    copyLink: copySkillLink,
  } = usePublishDialog({
    isOpen,
    popupId: "skill_published",
    linkUrl: skillUrl,
    onDismiss,
  });
  const xShareUrl = useMemo(() => buildXShareUrl(displayName, skillUrl), [displayName, skillUrl]);
  const discordShareText = useMemo(
    () => buildDiscordShareText(displayName, skillUrl),
    [displayName, skillUrl],
  );

  return (
    <PublishDialogFrame
      open={isOpen && !dismissed}
      onDismiss={dismiss}
      title={
        <>
          <span>It's alive!</span>
          <span className="text-[1.35rem] leading-none" aria-hidden="true">
            🦞
          </span>
        </>
      }
      description="Give your skill a first boost in the OpenClaw community or share it with your network."
      className="[--discord-accent:#5865F2]"
    >
      <div>
        <div className="relative z-10 rounded-t-[var(--radius-md)] rounded-b-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:color-mix(in_srgb,var(--surface-muted)_78%,var(--surface))] px-3.5 pb-3.5 pt-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <MarketplaceIcon
              kind="skill"
              label={displayName}
              imageUrl={skill?.icon}
              skill={skill}
              tone="muted"
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
              <PublishDialogPublisher publisher={publisher} />
            </div>
          </div>
        </div>
        <PublishDialogLink linkUrl={skillUrl}>
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
        </PublishDialogLink>
      </div>

      <div className="skill-publish-share-list" aria-label="Share destinations">
        <ShareListAction
          href={OPENCLAW_SKILLS_DISCORD_URL}
          title="Share on Discord"
          mobileTitle="Share with the OpenClaw community"
          channelName="#skills"
          serverName="Friends of the Crustacean 🦞🤝"
          onClick={(event) => {
            emitAnalytics("select_content", {
              content_type: "navigation",
              content_id: "share:discord",
              ui_location: "publish",
              ...analyticsExternalLinkParameters(event.currentTarget, window.location.origin),
            });
            const operation = captureAnalyticsOperation();
            void copyText(discordShareText)
              .then((copied) =>
                operation?.emit("copy_action", {
                  content_type: "navigation",
                  action_result: copied ? "success" : "error",
                  ui_location: "publish",
                  method: "discord",
                }),
              )
              .catch(() =>
                operation?.emit("copy_action", {
                  content_type: "navigation",
                  action_result: "error",
                  ui_location: "publish",
                  method: "discord",
                }),
              );
          }}
          icon={<DiscordIcon className="h-3.5 w-3.5 text-white" aria-hidden="true" />}
        />
        <span
          className="shrink-0 bg-[color:color-mix(in_srgb,var(--line)_82%,transparent)] h-px w-full"
          aria-hidden="true"
        />
        <ShareListAction
          href={xShareUrl}
          onClick={(event) =>
            emitAnalytics("select_content", {
              content_type: "navigation",
              content_id: "share:x",
              ui_location: "publish",
              ...analyticsExternalLinkParameters(event.currentTarget, window.location.origin),
            })
          }
          title="Share on Twitter"
          icon={<XIcon className="h-3.5 w-3.5" aria-hidden="true" />}
        />
      </div>

      <div className="mt-2 flex justify-end">
        <Button
          type="button"
          className="min-h-0 border-transparent bg-transparent p-0 text-[color:var(--ink-soft)] hover:not-disabled:border-transparent hover:not-disabled:bg-transparent hover:not-disabled:text-[color:var(--ink)]"
          onClick={() => dismiss("button")}
        >
          View skill
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </PublishDialogFrame>
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

function ShareListAction({
  href,
  title,
  mobileTitle,
  channelName,
  serverName,
  onClick,
  icon,
}: {
  href: string;
  title: string;
  mobileTitle?: string;
  channelName?: string;
  serverName?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
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
        <ExternalLink className="h-3 w-3 shrink-0 opacity-55 transition group-hover:opacity-100" />
      </span>
    </a>
  );
}
