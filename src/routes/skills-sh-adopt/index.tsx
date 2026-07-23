import { createFileRoute, Link } from "@tanstack/react-router";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  Check,
  ChevronRight,
  CircleAlert,
  GitCommitHorizontal,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Container } from "../../components/layout/Container";
import { PublisherOwnerSelect } from "../../components/PublisherOwnerSelect";
import { SignInPrompt } from "../../components/SignInPrompt";
import { Button } from "../../components/ui/button";
import { formatCompactStat } from "../../lib/numberFormat";
import { useAuthStatus } from "../../lib/useAuthStatus";

export const Route = createFileRoute("/skills-sh-adopt/")({
  component: SkillsShBulkAdoptionPage,
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

type PreviewResult = FunctionReturnType<
  typeof api.skillsShBulkAdoption.previewMirroredPublisherEntries
>;
type PreviewItem = PreviewResult["page"][number];

const PAGE_SIZE = 20;

function isRetryableAdoptionResult(status: string | undefined) {
  return status === "stale" || status === "canceled";
}

export function SkillsShBulkAdoptionPage() {
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
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [starting, setStarting] = useState(false);
  const [results, setResults] = useState<Record<string, string>>({});
  const previewRequestId = useRef(0);
  const loadPreview = useAction(api.skillsShBulkAdoption.previewMirroredPublisherEntries);
  const startAdoption = useAction(api.skillsShAdoption.startMirroredInteractive);

  useEffect(() => {
    if (manageablePublishers.length === 0) {
      if (publisherHandle) setPublisherHandle("");
      return;
    }
    if (manageablePublishers.some((entry) => entry.publisher.handle === publisherHandle)) return;
    setPublisherHandle(manageablePublishers[0]!.publisher.handle);
  }, [manageablePublishers, publisherHandle]);

  useEffect(() => {
    previewRequestId.current += 1;
    setPreview(null);
    setSelected(new Set());
    setConfirmed(false);
    setResults({});
    setLoadingPreview(false);
  }, [publisherHandle]);

  if (isLoading) {
    return (
      <main className="py-10">
        <Container>
          <div className="h-72 animate-pulse bg-[color:var(--oc-bg-surface)]" />
        </Container>
      </main>
    );
  }
  if (!isAuthenticated || !me) {
    return <SignInPrompt title="Sign in to adopt mirrored skills." />;
  }

  const selectedPublisher = manageablePublishers.find(
    (entry) => entry.publisher.handle === publisherHandle,
  );
  const eligible =
    preview?.page.filter(
      (item) =>
        item.canStart &&
        item.start &&
        (!results[item.externalId] || isRetryableAdoptionResult(results[item.externalId])),
    ) ?? [];
  const selectedItems =
    preview?.page.filter(
      (item) =>
        selected.has(item.externalId) &&
        item.start &&
        (!results[item.externalId] || isRetryableAdoptionResult(results[item.externalId])),
    ) ?? [];

  const fetchPreview = async (cursor: string | null, append: boolean) => {
    if (!selectedPublisher) return;
    const requestId = ++previewRequestId.current;
    if (!append) setConfirmed(false);
    setLoadingPreview(true);
    try {
      const next = await loadPreview({
        publisherId: selectedPublisher.publisher._id,
        paginationOpts: { numItems: PAGE_SIZE, cursor },
      });
      if (requestId !== previewRequestId.current) return;
      setPreview((current) =>
        append && current
          ? {
              ...next,
              page: [...current.page, ...next.page],
            }
          : next,
      );
    } catch (error) {
      if (requestId !== previewRequestId.current) return;
      toast.error(error instanceof Error ? error.message : "Could not preview mirrored sources.");
    } finally {
      if (requestId === previewRequestId.current) setLoadingPreview(false);
    }
  };

  const toggleSelected = (externalId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(externalId)) next.delete(externalId);
      else next.add(externalId);
      return next;
    });
    setConfirmed(false);
  };

  const toggleEligible = () => {
    const allSelected =
      eligible.length > 0 && eligible.every((item) => selected.has(item.externalId));
    setSelected(allSelected ? new Set() : new Set(eligible.map((item) => item.externalId)));
    setConfirmed(false);
  };

  const startSelected = async () => {
    if (!selectedPublisher || !confirmed || selectedItems.length === 0) return;
    setStarting(true);
    const nextResults = { ...results };
    try {
      for (const item of selectedItems) {
        if (!item.start) continue;
        const result = await startAdoption({
          publisherId: selectedPublisher.publisher._id,
          externalId: item.externalId,
          ...item.start,
        });
        nextResults[item.externalId] = result.status;
        setResults({ ...nextResults });
      }
      toast.success(
        `${selectedItems.length} adoption request${selectedItems.length === 1 ? "" : "s"} started.`,
      );
      setConfirmed(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Bulk adoption stopped.");
    } finally {
      setStarting(false);
    }
  };

  return (
    <main className="skills-sh-bulk-page py-10 sm:py-14">
      <Container>
        <header className="skills-sh-bulk-header">
          <div>
            <p className="font-mono text-xs text-[color:var(--oc-text-muted)]">skills.sh mirror</p>
            <h1 className="mt-2 font-display text-3xl font-black text-[color:var(--oc-text-primary)]">
              Adopt mirrored skills
            </h1>
          </div>
          <div className="skills-sh-bulk-publisher">
            <label htmlFor="bulk-adoption-publisher">Publisher</label>
            <PublisherOwnerSelect
              id="bulk-adoption-publisher"
              value={publisherHandle}
              memberships={manageablePublishers}
              onValueChange={setPublisherHandle}
            />
          </div>
        </header>

        <section className="skills-sh-bulk-toolbar">
          <div>
            <h2>Verified sources</h2>
            <p>
              {preview
                ? `${preview.page.length} mirrored source${preview.page.length === 1 ? "" : "s"}`
                : "Preview sources owned by this GitHub publisher."}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!selectedPublisher || loadingPreview}
            onClick={() => void fetchPreview(null, false)}
          >
            {loadingPreview ? (
              <Loader2 aria-hidden="true" size={16} className="animate-spin" />
            ) : (
              <RefreshCw aria-hidden="true" size={16} />
            )}
            {preview ? "Refresh" : "Preview sources"}
          </Button>
        </section>

        {preview ? (
          <>
            <div className="skills-sh-bulk-selection-bar">
              <button type="button" onClick={toggleEligible} disabled={eligible.length === 0}>
                {eligible.length > 0 && eligible.every((item) => selected.has(item.externalId))
                  ? "Clear selection"
                  : "Select eligible"}
              </button>
              <span>{selected.size} selected</span>
            </div>

            <div className="skills-sh-bulk-list">
              {preview.page.map((item) => (
                <BulkPreviewRow
                  key={item.externalId}
                  item={item}
                  selected={selected.has(item.externalId)}
                  result={results[item.externalId]}
                  onToggle={() => toggleSelected(item.externalId)}
                />
              ))}
            </div>

            {!preview.isDone ? (
              <div className="skills-sh-bulk-footer">
                <Button
                  type="button"
                  variant="outline"
                  disabled={loadingPreview}
                  onClick={() => void fetchPreview(preview.continueCursor, true)}
                >
                  {loadingPreview ? (
                    <Loader2 aria-hidden="true" size={16} className="animate-spin" />
                  ) : null}
                  Load more
                </Button>
              </div>
            ) : null}

            {selectedItems.length > 0 ? (
              <section className="skills-sh-bulk-confirm">
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  <span>
                    Start one exact-source ClawHub scan for each of the {selectedItems.length}{" "}
                    selected mirrored skills.
                  </span>
                </label>
                <Button
                  type="button"
                  variant="primary"
                  disabled={!confirmed}
                  loading={starting}
                  onClick={() => void startSelected()}
                >
                  <ShieldCheck aria-hidden="true" size={16} />
                  Start selected adoptions
                </Button>
              </section>
            ) : null}
          </>
        ) : (
          <div className="skills-sh-bulk-empty">
            <GitCommitHorizontal aria-hidden="true" size={22} />
            <p>Select a publisher and preview its mirrored GitHub sources.</p>
          </div>
        )}
      </Container>
    </main>
  );
}

function BulkPreviewRow({
  item,
  selected,
  result,
  onToggle,
}: {
  item: PreviewItem;
  selected: boolean;
  result?: string;
  onToggle: () => void;
}) {
  const route = `/skills-sh-adopt/${item.externalId}`;
  const status = result ?? item.classification;
  const statusLabel = result ? result.replaceAll("_", " ") : classificationLabel(item);
  return (
    <article className="skills-sh-bulk-row" data-selected={selected ? "true" : "false"}>
      <input
        type="checkbox"
        aria-label={`Select ${item.displayName}`}
        checked={selected}
        disabled={
          !item.canStart || !item.start || (Boolean(result) && !isRetryableAdoptionResult(result))
        }
        onChange={onToggle}
      />
      <div className="skills-sh-bulk-row-main">
        <div className="skills-sh-bulk-row-title">
          <span>{item.displayName}</span>
          <span className="skills-sh-bulk-status" data-status={status}>
            {result === "promoted" ? (
              <Check aria-hidden="true" size={13} />
            ) : item.canStart ? (
              <ShieldCheck aria-hidden="true" size={13} />
            ) : (
              <CircleAlert aria-hidden="true" size={13} />
            )}
            {statusLabel}
          </span>
        </div>
        <p className="font-mono">{item.externalId}</p>
        {item.source ? (
          <p>
            {item.source.repository} · {item.source.githubPath} ·{" "}
            {item.source.githubCommit.slice(0, 10)}
          </p>
        ) : (
          <p>Exact source is unavailable.</p>
        )}
      </div>
      <span className="skills-sh-bulk-installs" title="skills.sh installs">
        {formatCompactStat(item.upstreamInstalls)}
      </span>
      <Link
        to={route}
        className="skills-sh-bulk-row-link"
        aria-label={`Review ${item.displayName}`}
      >
        <ChevronRight aria-hidden="true" size={18} />
      </Link>
    </article>
  );
}

function classificationLabel(item: PreviewItem) {
  switch (item.classification) {
    case "new-destination":
      return "New destination";
    case "replacement":
      return "Replaces current content";
    case "ownership-conflict":
      return "Conflict";
    case "unavailable":
      return "Unavailable";
  }
  const exhaustive: never = item.classification;
  return exhaustive;
}
