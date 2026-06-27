import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  PLATFORM_CHANGELOG_ENTRIES,
  type PlatformChangelogSurface,
} from "../components/dashboard/platformChangelog";

export const Route = createFileRoute("/changelog")({
  component: ChangelogPage,
});

function ChangelogPage() {
  const [surface, setSurface] = useState<"All" | PlatformChangelogSurface>("All");
  const visibleEntries = PLATFORM_CHANGELOG_ENTRIES.filter(
    (entry) => surface === "All" || entry.surface === surface,
  );
  return (
    <main className="browse-page browse-page-borderless-header changelog-page">
      <section className="changelog-hero" aria-labelledby="changelog-title">
        <header className="changelog-page-header">
          <h1 id="changelog-title" className="browse-title">
            Changelog
          </h1>
          <div className="clawhub-segmented changelog-surface-tabs" role="tablist" aria-label="Changelog surface">
            {(["All", "Web", "CLI", "API"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={surface === option}
                className={`clawhub-segmented-btn${surface === option ? " is-active" : ""}`}
                onClick={() => setSurface(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </header>
      </section>

      <section className="changelog-timeline" aria-label="Platform changelog">
        {visibleEntries.map((entry) => (
          <article key={entry.id} id={entry.id} className="changelog-entry">
            <div className="changelog-entry-meta">
              <span>{entry.category}</span>
              <span>{entry.when === "Recent" ? "2d ago" : entry.when}</span>
            </div>
            <div className="changelog-entry-body">
              <h2>{entry.title}</h2>
              <p>{entrySummary(entry.id)}</p>
              {entry.to ? (
                <Link to={entry.to} search={entry.search} className="changelog-entry-link">
                  Open area
                </Link>
              ) : entry.href ? (
                <a href={entry.href} className="changelog-entry-link" target="_blank" rel="noreferrer">
                  Read more
                </a>
              ) : null}
            </div>
          </article>
        ))}
        {visibleEntries.length === 0 ? (
          <p className="changelog-empty">No {surface} updates yet.</p>
        ) : null}
      </section>
    </main>
  );
}

function entrySummary(id: string) {
  if (id === "github-import") return "Import public GitHub repositories into ClawHub faster.";
  if (id === "publisher-workspace") return "Manage skills, plugins, reviews, and publishing state from one workspace.";
  if (id === "download-insights") return "Track download movement across skills and plugins.";
  if (id === "needs-attention") return "Critical validation and security items now surface in the dashboard.";
  if (id === "plugin-validation") return "Validation findings include clearer guidance for common plugin issues.";
  return "Publisher-facing improvements for managing catalog packages.";
}
