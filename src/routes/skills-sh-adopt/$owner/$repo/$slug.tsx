import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Check, ExternalLink, GitCommitHorizontal, ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Container } from "../../../../components/layout/Container";
import { PublisherOwnerSelect } from "../../../../components/PublisherOwnerSelect";
import { SignInPrompt } from "../../../../components/SignInPrompt";
import { Button } from "../../../../components/ui/button";
import { useAuthStatus } from "../../../../lib/useAuthStatus";

export const Route = createFileRoute("/skills-sh-adopt/$owner/$repo/$slug")({
  component: SkillsShAdoptionPage,
});

type PublisherMembership = {
  publisher: {
    _id: Id<"publishers">;
    handle: string;
    displayName: string;
    kind: "user" | "org";
    official: boolean;
  };
  role: "owner" | "admin" | "publisher";
};

type AdoptionStatus =
  | "pending_scan"
  | "ready_to_promote"
  | "rejected"
  | "stale"
  | "canceled"
  | "promoted";

const BLOCKING_MESSAGES: Record<string, string> = {
  source_incomplete: "This mirrored source is missing an immutable commit, path, or content hash.",
  github_identity_missing: "Reconnect GitHub before adopting this personal source.",
  github_identity_pending: "GitHub identity reconciliation is still required for this account.",
  github_identity_mismatch: "The connected GitHub account does not own this source.",
  github_org_unverified: "Link this publisher to the matching GitHub organization first.",
  github_org_mismatch: "This publisher is linked to a different GitHub organization.",
  github_org_membership_missing: "Reconnect GitHub to verify active organization membership.",
  github_org_admin_required: "Current GitHub organization admin access is required.",
  github_org_proof_stale: "Reconnect GitHub to refresh organization admin verification.",
  destination_alias_conflict:
    "This publisher already uses the destination route as an alias. Resolve that route before adopting.",
};

export function SkillsShAdoptionPage() {
  const params = Route.useParams();
  const { isAuthenticated, isLoading, me } = useAuthStatus();
  const memberships = useQuery(
    api.publishers.listMine,
    me ? { includePublishedItems: false } : "skip",
  ) as PublisherMembership[] | undefined;
  const manageablePublishers = useMemo(
    () => (memberships ?? []).filter((entry) => entry.role === "owner" || entry.role === "admin"),
    [memberships],
  );
  const [publisherHandle, setPublisherHandle] = useState("");
  const [confirmedPreviewKey, setConfirmedPreviewKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resultStatus, setResultStatus] = useState<AdoptionStatus | null>(null);

  useEffect(() => {
    if (manageablePublishers.length === 0) {
      if (publisherHandle) setPublisherHandle("");
      return;
    }
    if (manageablePublishers.some((entry) => entry.publisher.handle === publisherHandle)) return;
    const sourceMatch = manageablePublishers.find(
      (entry) => entry.publisher.handle.toLowerCase() === params.owner.toLowerCase(),
    );
    setPublisherHandle((sourceMatch ?? manageablePublishers[0]).publisher.handle);
  }, [manageablePublishers, params.owner, publisherHandle]);

  const selected = manageablePublishers.find((entry) => entry.publisher.handle === publisherHandle);
  const externalId = `${params.owner}/${params.repo}/${params.slug}`.toLowerCase();
  const preview = useQuery(
    api.skillsShAdoption.getPreview,
    me && selected
      ? {
          publisherId: selected.publisher._id,
          externalId,
        }
      : "skip",
  );
  const startAdoption = useMutation(api.skillsShAdoption.startInteractive);
  const previewConfirmationKey = preview
    ? [
        preview.idempotencyKey,
        preview.destination.kind,
        preview.destination.fingerprint ?? preview.destination.skillId,
      ].join(":")
    : "";
  const confirmed =
    previewConfirmationKey.length > 0 && confirmedPreviewKey === previewConfirmationKey;

  useEffect(() => {
    setConfirmedPreviewKey(null);
    setResultStatus(null);
  }, [publisherHandle, previewConfirmationKey]);

  if (isLoading) {
    return (
      <main className="py-10">
        <Container size="narrow">
          <div className="h-72 animate-pulse rounded-[var(--oc-radius-inset)] bg-[color:var(--oc-bg-surface)]" />
        </Container>
      </main>
    );
  }
  if (!isAuthenticated || !me) {
    return <SignInPrompt title="Sign in to adopt this mirrored skill." />;
  }

  const blockingMessage = preview?.blockingReason
    ? (BLOCKING_MESSAGES[preview.blockingReason] ?? "This adoption is currently blocked.")
    : null;
  const destination = preview?.destination;
  const isReplacement = destination?.kind === "replace";

  const handleStart = async () => {
    if (!preview?.canStart || !preview.destination.fingerprint || !selected || !confirmed) return;
    setSubmitting(true);
    try {
      const result = await startAdoption({
        publisherId: selected.publisher._id,
        externalId: preview.source.externalId,
        sourceContentHash: preview.source.sourceContentHash,
        idempotencyKey: preview.idempotencyKey,
        expectedDestinationFingerprint: preview.destination.fingerprint,
      });
      setResultStatus(result.status);
      if (result.created) {
        toast.success("Adoption request created. Exact-source scan is waiting.");
      } else if (result.status === "rejected") {
        toast.error("The existing adoption request was rejected.");
      } else {
        toast.success(`Existing adoption request is ${formatAdoptionStatus(result.status)}.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start adoption.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="py-10 sm:py-14">
      <Container size="narrow">
        <header className="border-b border-[color:var(--oc-border-subtle)] pb-7">
          <p className="font-mono text-xs text-[color:var(--oc-text-muted)]">{externalId}</p>
          <h1 className="mt-2 font-display text-3xl font-black text-[color:var(--oc-text-primary)]">
            Adopt mirrored skill
          </h1>
        </header>

        <section className="border-b border-[color:var(--oc-border-subtle)] py-7">
          <label
            htmlFor="adoption-publisher"
            className="text-sm font-semibold text-[color:var(--oc-text-primary)]"
          >
            Publisher
          </label>
          <div className="mt-3">
            <PublisherOwnerSelect
              id="adoption-publisher"
              value={publisherHandle}
              memberships={manageablePublishers}
              onValueChange={setPublisherHandle}
            />
          </div>
        </section>

        {selected && preview === undefined ? (
          <div className="h-80 animate-pulse border-b border-[color:var(--oc-border-subtle)] py-7" />
        ) : preview === null ? (
          <p className="py-7 text-sm text-[color:var(--oc-text-secondary)]">
            This mirrored skill is not available for adoption.
          </p>
        ) : preview ? (
          <>
            <section className="border-b border-[color:var(--oc-border-subtle)] py-7">
              <div className="flex items-center gap-2">
                <GitCommitHorizontal
                  aria-hidden="true"
                  size={18}
                  className="text-[color:var(--oc-text-muted)]"
                />
                <h2 className="font-display text-lg font-bold text-[color:var(--oc-text-primary)]">
                  Exact source
                </h2>
              </div>
              <dl className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
                <SourceField label="Repository" value={preview.source.repository} />
                <SourceField label="Path" value={preview.source.githubPath ?? "Unavailable"} />
                <SourceField label="Commit" value={preview.source.githubCommit ?? "Unavailable"} />
                <SourceField
                  label="Folder hash"
                  value={preview.source.githubContentHash ?? "Unavailable"}
                />
                <div className="sm:col-span-2">
                  <SourceField
                    label="Mirror fingerprint"
                    value={preview.source.sourceContentHash}
                  />
                </div>
              </dl>
              <a
                className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[color:var(--oc-accent-primary)]"
                href={preview.source.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                View synchronized source
                <ExternalLink aria-hidden="true" size={14} />
              </a>
            </section>

            <section className="border-b border-[color:var(--oc-border-subtle)] py-7">
              <div className="flex items-center gap-2">
                {preview.canStart ? (
                  <ShieldCheck aria-hidden="true" size={18} className="text-status-success-fg" />
                ) : (
                  <TriangleAlert aria-hidden="true" size={18} className="text-status-error-fg" />
                )}
                <h2 className="font-display text-lg font-bold text-[color:var(--oc-text-primary)]">
                  Destination
                </h2>
              </div>

              {blockingMessage ? (
                <p className="mt-4 border-l-2 border-status-error-fg pl-3 text-sm leading-6 text-status-error-fg">
                  {blockingMessage}
                </p>
              ) : destination?.kind === "create" ? (
                <p className="mt-4 text-sm leading-6 text-[color:var(--oc-text-secondary)]">
                  A new native skill will be created at{" "}
                  <span className="font-mono text-[color:var(--oc-text-primary)]">
                    @{preview.publisher.handle}/{preview.source.slug}
                  </span>{" "}
                  only after the frozen candidate passes ClawHub scanning.
                </p>
              ) : isReplacement && destination.preserved ? (
                <>
                  <p className="mt-4 text-sm leading-6 text-[color:var(--oc-text-secondary)]">
                    The active content at{" "}
                    <span className="font-mono text-[color:var(--oc-text-primary)]">
                      @{preview.publisher.handle}/{preview.source.slug}
                    </span>{" "}
                    will switch only after this exact candidate passes.
                  </p>
                  <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                    <Metric label="Downloads" value={destination.preserved.downloads} />
                    <Metric label="Bookmarks" value={destination.preserved.bookmarks} />
                    <Metric label="Comments" value={destination.preserved.comments} />
                    <Metric label="Versions" value={destination.preserved.versions} />
                  </dl>
                  <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-[color:var(--oc-text-secondary)]">
                    <span className="inline-flex items-center gap-1.5">
                      <Check aria-hidden="true" size={14} />
                      Skill identity retained
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Check aria-hidden="true" size={14} />
                      Audit history retained
                    </span>
                    {destination.preserved.official ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Check aria-hidden="true" size={14} />
                        Official state retained
                      </span>
                    ) : null}
                  </div>
                </>
              ) : null}
            </section>

            {preview.canStart ? (
              <section className="pt-7">
                <label className="flex items-start gap-3 text-sm leading-6 text-[color:var(--oc-text-secondary)]">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-[color:var(--oc-accent-primary)]"
                    checked={confirmed}
                    onChange={(event) =>
                      setConfirmedPreviewKey(event.target.checked ? previewConfirmationKey : null)
                    }
                  />
                  <span>
                    {isReplacement
                      ? `Replace the active content at @${preview.publisher.handle}/${preview.source.slug} after this exact candidate passes ClawHub scanning.`
                      : `Create @${preview.publisher.handle}/${preview.source.slug} after this exact candidate passes ClawHub scanning.`}
                  </span>
                </label>
                <Button
                  className="mt-5"
                  variant="primary"
                  disabled={!confirmed || resultStatus !== null}
                  loading={submitting}
                  onClick={handleStart}
                >
                  <ShieldCheck aria-hidden="true" size={16} />
                  {resultStatus
                    ? adoptionStatusButtonLabel(resultStatus)
                    : "Create adoption request"}
                </Button>
              </section>
            ) : null}
          </>
        ) : manageablePublishers.length === 0 ? (
          <p className="py-7 text-sm text-[color:var(--oc-text-secondary)]">
            You need owner or admin access to a publisher before adopting this source.
          </p>
        ) : null}
      </Container>
    </main>
  );
}

function formatAdoptionStatus(status: AdoptionStatus) {
  return status.replaceAll("_", " ");
}

function adoptionStatusButtonLabel(status: AdoptionStatus) {
  switch (status) {
    case "pending_scan":
      return "Waiting for scan";
    case "ready_to_promote":
      return "Ready to promote";
    case "rejected":
      return "Scan rejected";
    case "stale":
      return "Request stale";
    case "canceled":
      return "Request canceled";
    case "promoted":
      return "Adopted";
  }
  return "Adoption request";
}

function SourceField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-[color:var(--oc-text-muted)]">{label}</dt>
      <dd className="mt-1 break-all font-mono text-sm text-[color:var(--oc-text-primary)]">
        {value}
      </dd>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-[color:var(--oc-text-muted)]">{label}</dt>
      <dd className="mt-1 text-lg font-bold text-[color:var(--oc-text-primary)]">
        {value.toLocaleString()}
      </dd>
    </div>
  );
}
