import { useConvex, useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";

type DownloadSummary = {
  scope: "templates";
  status: "pending" | "ready";
  generatedAt: number | null;
  windowStartAt: number | null;
  windowEndAt: number | null;
  downloadsLast24h: number | null;
  downloadsAllTime: number | null;
  countingPaused: boolean;
  refreshInProgress?: boolean;
  staleAfterAt?: number | null;
  lastError?: string | null;
  counterLagNote?: string;
  consistencyNote?: string;
};

const numbers = new Intl.NumberFormat("en-US");
const timestamp = (value: number) =>
  new Date(value).toLocaleString(undefined, { timeZone: "UTC", timeZoneName: "short" });

export function DownloadsPage() {
  const convex = useConvex();
  const requestRefresh = useMutation(api.downloadAnalytics.refresh);
  const [summary, setSummary] = useState<DownloadSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    let active = true;
    const read = () => {
      void convex
        .query(api.downloadAnalytics.getSummary, {})
        .then((value) => {
          if (active) {
            setSummary(value);
            setError(null);
            setNow(Date.now());
          }
        })
        .catch(() => {
          if (active)
            setError("Could not load the download summary. Retry or check your admin access.");
        });
    };
    read();
    const timer = setInterval(read, 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [convex]);

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      setSummary(await requestRefresh({}));
      setNow(Date.now());
    } catch {
      setError("Could not refresh the download summary. The last available numbers are unchanged.");
    } finally {
      setRefreshing(false);
    }
  };
  const ready = summary?.status === "ready";
  const stale =
    summary?.generatedAt != null &&
    now > (summary.staleAfterAt ?? summary.generatedAt + 30 * 60_000);
  const refreshRequested = summary?.refreshInProgress;
  const count = (value: number | null | undefined) =>
    ready && value != null ? numbers.format(value) : "—";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1>Template downloads</h1>
          <p className="text-muted-foreground">
            Recorded downloads across public, undeleted Templates.
          </p>
        </div>
        <Button variant="outline" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? "Requesting refresh…" : "Refresh summary"}
        </Button>
      </header>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      {summary?.lastError ? <p role="alert">{summary.lastError}</p> : null}
      {summary?.countingPaused ? (
        <Card>
          <p>
            Download counting is paused. New downloads may not be recorded; totals can contain gaps.
          </p>
        </Card>
      ) : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-busy={!summary && !error}>
        <Card>
          <h2 className="text-sm text-muted-foreground">Past 24 hours</h2>
          <p className="text-4xl font-semibold tabular-nums">{count(summary?.downloadsLast24h)}</p>
          <p className="text-sm text-muted-foreground">
            A rolling 24-hour window, not yesterday’s UTC total.
          </p>
        </Card>
        <Card>
          <h2 className="text-sm text-muted-foreground">Lifetime</h2>
          <p className="text-4xl font-semibold tabular-nums">{count(summary?.downloadsAllTime)}</p>
          <p className="text-sm text-muted-foreground">
            Durable recorded totals, including events no longer retained.
          </p>
        </Card>
      </div>
      <Card>
        <h2 className="text-base font-semibold">Summary freshness</h2>
        {!summary && !error ? <p role="status">Loading summary…</p> : null}
        {summary?.status === "pending" ? (
          <p role="status">
            The first summary is not ready. Request a refresh or wait for the next scheduled run.
          </p>
        ) : null}
        {summary?.generatedAt != null ? (
          <p>
            Generated{" "}
            <time dateTime={new Date(summary.generatedAt).toISOString()}>
              {timestamp(summary.generatedAt)}
            </time>
          </p>
        ) : null}
        {summary?.windowStartAt != null && summary.windowEndAt != null ? (
          <p className="text-sm text-muted-foreground">
            Window: {timestamp(summary.windowStartAt)} – {timestamp(summary.windowEndAt)}
          </p>
        ) : null}
        {stale ? (
          <p role="status">
            This summary is older than 30 minutes. Request a refresh to update it.
          </p>
        ) : null}
        {refreshRequested ? (
          <p role="status">
            Refresh requested. Background processing may take a few minutes; this page checks for
            updates automatically.
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          Summaries update about every 15 minutes. Reads use a stored summary, not a live recount.
        </p>
      </Card>
      <section className="text-sm text-muted-foreground">
        <h2 className="text-base font-semibold">What these numbers mean</h2>
        <p>
          Downloads are not installs or unique people. Repeated downloads by the same identity for
          the same Template on the same UTC day count once.
        </p>
        <p>
          Only public, undeleted Templates are included, not plugins or skills. Lifetime totals
          reflect recorded history, not a historical backfill. Counting pauses can leave permanent
          gaps.
        </p>
        {summary?.counterLagNote ? <p>{summary.counterLagNote}</p> : null}
        {summary?.consistencyNote ? <p>{summary.consistencyNote}</p> : null}
      </section>
    </div>
  );
}
