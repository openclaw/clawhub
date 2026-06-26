import { Link } from "@tanstack/react-router";
import { ArrowRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  CLAWHUB_PLATFORM_CHANGELOG_URL,
  PLATFORM_CHANGELOG_ENTRIES,
  type PlatformChangelogEntry,
} from "./platformChangelog";

function GitHubLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.16 1.18.92-.26 1.9-.38 2.88-.39.98 0 1.96.13 2.88.39 2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.24 2.75.12 3.04.74.8 1.18 1.83 1.18 3.08 0 4.42-2.69 5.39-5.25 5.67.42.36.78 1.07.78 2.15 0 1.55-.01 2.8-.01 3.18 0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

const CHANGELOG_VISIBLE_LIMIT = 4;
const PROMO_DISMISS_KEY = "clawhub.dashboard.sidebar.import-promo.dismissed";
const CHANGELOG_DISMISS_KEY = "clawhub.dashboard.sidebar.changelog.dismissed";

type DashboardRightSidebarProps = {
  ownerHandle: string;
};

function useDismissedStorage(storageKey: string) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(storageKey) === "1");
    } catch {
      setDismissed(false);
    }
  }, [storageKey]);

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // ignore write failures in private browsing, etc.
    }
  };

  return { dismissed, dismiss };
}

function SidebarDismissButton({
  label,
  className,
  onDismiss,
}: {
  label: string;
  className?: string;
  onDismiss: () => void;
}) {
  return (
    <button
      type="button"
      className={className ? `dashboard-sidebar-dismiss ${className}` : "dashboard-sidebar-dismiss"}
      aria-label={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
      }}
    >
      <X className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

export function DashboardRightSidebar({ ownerHandle }: DashboardRightSidebarProps) {
  const changelogEntries = PLATFORM_CHANGELOG_ENTRIES.slice(0, CHANGELOG_VISIBLE_LIMIT);
  const promoDismiss = useDismissedStorage(PROMO_DISMISS_KEY);
  const changelogDismiss = useDismissedStorage(CHANGELOG_DISMISS_KEY);

  return (
    <aside className="dashboard-right-sidebar" aria-label="Publisher sidebar">
      {!promoDismiss.dismissed ? (
        <article className="dashboard-sidebar-promo">
          <SidebarDismissButton
            label="Dismiss GitHub import promo"
            className="dashboard-sidebar-promo-dismiss"
            onDismiss={promoDismiss.dismiss}
          />
          <div className="dashboard-sidebar-promo-art-wrap">
            <img
              src="/github-import-hero-art.png"
              alt=""
              className="dashboard-sidebar-promo-art"
              draggable={false}
              aria-hidden="true"
            />
          </div>
          <div className="dashboard-sidebar-promo-text">
            <h2 className="dashboard-sidebar-promo-title">Import from GitHub</h2>
            <p className="dashboard-sidebar-promo-copy">
              Pull skills from a public repository and publish in minutes.
            </p>
          </div>
          <Link
            to="/import"
            search={{ ownerHandle: ownerHandle || undefined }}
            className="dashboard-sidebar-promo-btn"
          >
            <GitHubLogo className="h-4 w-4" />
            Import skills
          </Link>
        </article>
      ) : null}

      {!changelogDismiss.dismissed ? (
        <details className="dashboard-sidebar-changelog" open>
          <summary className="dashboard-sidebar-changelog-summary">
            <span className="dashboard-sidebar-changelog-summary-label">
              Latest from our changelog
            </span>
            <span className="dashboard-sidebar-changelog-summary-actions">
              <SidebarDismissButton
                label="Dismiss changelog"
                onDismiss={changelogDismiss.dismiss}
              />
            </span>
          </summary>
          <ol className="dashboard-sidebar-timeline" aria-label="Recent platform updates">
            {changelogEntries.map((entry) => (
              <li key={entry.id} className="dashboard-sidebar-timeline-item">
                <div className="dashboard-sidebar-timeline-rail" aria-hidden="true">
                  <span className="dashboard-sidebar-timeline-node" />
                </div>
                <div className="dashboard-sidebar-timeline-copy">
                  <ChangelogEntryLine entry={entry} ownerHandle={ownerHandle} />
                </div>
              </li>
            ))}
          </ol>
          <a
            href={CLAWHUB_PLATFORM_CHANGELOG_URL}
            className="dashboard-sidebar-feed-link"
            aria-label="View full platform changelog on GitHub"
            target="_blank"
            rel="noreferrer"
          >
            View changelog
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </details>
      ) : null}
    </aside>
  );
}

function ChangelogEntryLine({
  entry,
  ownerHandle,
}: {
  entry: PlatformChangelogEntry;
  ownerHandle: string;
}) {
  const isRecent = entry.when === "Recent";

  return (
    <div className="dashboard-sidebar-timeline-entry">
      {isRecent ? (
        <span className="dashboard-sidebar-timeline-kind">{entry.category}</span>
      ) : (
        <time className="dashboard-sidebar-timeline-date" dateTime={entry.iso}>
          {entry.when}
        </time>
      )}
      <PlatformChangelogTitle entry={entry} ownerHandle={ownerHandle} />
    </div>
  );
}

function PlatformChangelogTitle({
  entry,
  ownerHandle,
}: {
  entry: PlatformChangelogEntry;
  ownerHandle: string;
}) {
  const className = "dashboard-sidebar-timeline-name";

  if (entry.to) {
    const search =
      entry.to === "/import"
        ? { ownerHandle: ownerHandle || undefined, ...entry.search }
        : entry.search;

    return (
      <Link to={entry.to} search={search} className={className}>
        {entry.title}
      </Link>
    );
  }

  if (entry.href) {
    return (
      <a href={entry.href} className={className} target="_blank" rel="noreferrer">
        {entry.title}
      </a>
    );
  }

  return <span className={className}>{entry.title}</span>;
}
