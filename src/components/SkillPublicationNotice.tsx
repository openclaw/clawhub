import type { SkillPublicationProgress } from "../../convex/lib/skillPublicationProgress";
import { OPENCLAW_SUPPORT_URL } from "../lib/nav-items";
import { cn } from "../lib/utils";

const notices: Record<SkillPublicationProgress["stage"], { title: string; detail: string }> = {
  pending_checks: {
    title: "Pending publication",
    detail: "ClawHub is completing required security and publication checks.",
  },
  checks_failed: {
    title: "Publication checks failed",
    detail: "One or more security checks could not complete. The uploaded version is retained.",
  },
  checks_incomplete: {
    title: "Publication checks incomplete",
    detail: "Some required security evidence is still missing. This version remains private.",
  },
  ready_to_finalize: {
    title: "Publication queued",
    detail: "Security checks have completed. This version is waiting for publication to finish.",
  },
  finalizing: {
    title: "Publishing version",
    detail: "ClawHub is finishing publication of this version.",
  },
  failed: {
    title: "Publication failed",
    detail:
      "Publication could not finish. Contact support with the version shown here before submitting another version.",
  },
  blocked: {
    title: "Publication blocked",
    detail:
      "Security checks blocked this version. Review its stored scan report and contact support if you need a review.",
  },
  expired: {
    title: "Publication expired",
    detail:
      "The publication attempt expired before this version became public. Contact support with the version shown here.",
  },
  unavailable: {
    title: "Publication status unavailable",
    detail:
      "ClawHub has not recorded a complete publication status for this version. Contact support with the version shown here.",
  },
};
const checkLabels = {
  pending: "waiting",
  clean: "passed",
  blocked: "blocked",
  failed: "could not complete",
};

export function SkillPublicationNotice({
  progress,
  publishedVersion,
}: {
  progress: SkillPublicationProgress;
  publishedVersion?: string;
}) {
  const notice = notices[progress.stage];
  const needsAttention = !["pending_checks", "ready_to_finalize", "finalizing"].includes(
    progress.stage,
  );
  return (
    <div
      className={cn("pending-banner", progress.stage === "blocked" && "pending-banner-blocked")}
      role="status"
    >
      <div className="pending-banner-content">
        <strong>{notice.title}</strong>
        <p>
          Version <b className="break-all">{progress.version}</b> is not yet public or installable.{" "}
          {notice.detail}
        </p>
        {progress.checks ? (
          <p>
            Secret check: {checkLabels[progress.checks.trufflehog]}. Security check:{" "}
            {checkLabels[progress.checks.clawscan]}.
          </p>
        ) : null}
        {progress.retrying ? (
          <p>
            This upload is waiting for another check attempt; you do not need to publish a new
            version.
          </p>
        ) : null}
        {publishedVersion ? (
          <p>
            The install instructions and security result below are for the current public version,{" "}
            {publishedVersion}.
          </p>
        ) : null}
        {needsAttention ? (
          <a
            href={OPENCLAW_SUPPORT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            Contact support
          </a>
        ) : null}
      </div>
    </div>
  );
}
