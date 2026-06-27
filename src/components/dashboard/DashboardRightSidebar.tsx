import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useEffect, useState, type SyntheticEvent } from "react";
import {
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
const CHANGELOG_STORAGE_KEY = "clawhub.dashboard.changelog";

type DashboardRightSidebarProps = {
  ownerHandle: string;
};

export function DashboardRightSidebar({ ownerHandle }: DashboardRightSidebarProps) {
  const changelogEntries = PLATFORM_CHANGELOG_ENTRIES.slice(0, CHANGELOG_VISIBLE_LIMIT);
  const [isChangelogOpen, setIsChangelogOpen] = useState(true);

  useEffect(() => {
    if (window.localStorage.getItem(CHANGELOG_STORAGE_KEY) === "closed") {
      setIsChangelogOpen(false);
    }
  }, []);

  function handleChangelogToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    const nextOpen = event.currentTarget.open;
    setIsChangelogOpen(nextOpen);
    window.localStorage.setItem(CHANGELOG_STORAGE_KEY, nextOpen ? "open" : "closed");
  }

  return (
    <aside className="dashboard-right-sidebar" aria-label="Publisher sidebar">
      <article className="dashboard-sidebar-promo">
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
            Import skills directly from your GitHub repositories.
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

      <details
        className="dashboard-sidebar-changelog"
        open={isChangelogOpen}
        onToggle={handleChangelogToggle}
      >
        <summary className="dashboard-sidebar-changelog-summary">
          <span className="dashboard-sidebar-changelog-summary-label">Latest updates</span>
        </summary>
        <ol className="dashboard-sidebar-timeline" aria-label="Recent platform updates">
          {changelogEntries.map((entry) => (
            <li key={entry.id} className="dashboard-sidebar-timeline-item">
              <div className="dashboard-sidebar-timeline-rail" aria-hidden="true">
                <span className="dashboard-sidebar-timeline-node" />
              </div>
              <div className="dashboard-sidebar-timeline-copy">
                <ChangelogEntryLine entry={entry} />
              </div>
            </li>
          ))}
        </ol>
        <Link
          to="/changelog"
          className="dashboard-sidebar-feed-link"
          aria-label="See changelog"
        >
          See changelog
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </details>
    </aside>
  );
}

function ChangelogEntryLine({
  entry,
}: {
  entry: PlatformChangelogEntry;
}) {
  const isRecent = entry.when === "Recent";

  return (
    <div className="dashboard-sidebar-timeline-entry">
      <span className="dashboard-sidebar-timeline-kind">
        {entry.category} · {isRecent ? "2d ago" : entry.when}
      </span>
      <PlatformChangelogTitle entry={entry} />
    </div>
  );
}

function PlatformChangelogTitle({
  entry,
}: {
  entry: PlatformChangelogEntry;
}) {
  const className = "dashboard-sidebar-timeline-name";
  return (
    <a href={`/changelog#${entry.id}`} className={className}>
      {entry.title}
    </a>
  );
}
