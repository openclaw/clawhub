import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { BrowseTabs } from "../components/BrowseControls";
import {
  PLATFORM_CHANGELOG_ENTRIES,
  type PlatformChangelogSurface,
} from "../components/dashboard/platformChangelog";

export const Route = createFileRoute("/changelog")({
  component: ChangelogPage,
});

function ChangelogPage() {
  const [surface, setSurface] = useState<"All" | PlatformChangelogSurface>("All");
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const visibleEntries = PLATFORM_CHANGELOG_ENTRIES.filter(
    (entry) => surface === "All" || entry.surface === surface,
  );

  return (
    <main className="browse-page browse-page-borderless-header changelog-page">
      <header className="changelog-page-header">
        <Link to="/dashboard" className="changelog-dashboard-link">
          ← Go to dashboard
        </Link>
        <h1 id="changelog-title" className="browse-title">
          Changelog
        </h1>
      </header>

      <div className="changelog-filter-bar">
        <BrowseTabs
          ariaLabel="Changelog surface"
          options={(["All", "Web", "CLI", "API"] as const).map((option) => ({
            value: option,
            label: option,
          }))}
          value={surface}
          onChange={(value) => {
            if (value === "All" || value === "Web" || value === "CLI" || value === "API") {
              setSurface(value);
            }
          }}
        />
      </div>

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
              <button
                type="button"
                className="changelog-entry-read-more"
                onClick={() => setExpandedEntryId(expandedEntryId === entry.id ? null : entry.id)}
              >
                {expandedEntryId === entry.id ? "Show less −" : "Read more +"}
              </button>
              {expandedEntryId === entry.id ? (
                <div className="changelog-entry-expanded">
                  <p>{entryDetails(entry.id)}</p>
                  {entry.to ? (
                    <Link to={entry.to} search={entry.search} className="changelog-entry-link">
                      {entryActionLabel(entry.id)}
                    </Link>
                  ) : entry.href ? (
                    <a
                      href={entry.href}
                      className="changelog-entry-link"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {entryActionLabel(entry.id)}
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
          </article>
        ))}
        {visibleEntries.length === 0 ? (
          <p className="changelog-empty">No {surface} updates yet.</p>
        ) : null}
      </section>

      <section className="changelog-art" aria-hidden="true" />
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

function entryDetails(id: string) {
  if (id === "github-import") {
    return "Paste a public repository URL, choose what to import, and bring a SKILL.md into your catalog without rebuilding the package by hand.";
  }
  if (id === "publisher-workspace") {
    return "The dashboard now groups review state, publishing actions, package visibility, and catalog metrics in one place for daily publisher work.";
  }
  if (id === "download-insights") {
    return "Stats now separate skill and plugin movement so publishers can see what is gaining traction without leaving the workspace.";
  }
  if (id === "needs-attention") {
    return "Blocked, hidden, and validation-sensitive packages are pulled into a triage strip so serious review work is visible before routine catalog management.";
  }
  if (id === "plugin-validation") {
    return "Plugin validation now points to concrete fixes for deprecated hooks, unsafe behavior, and packaging issues that block a clean publish.";
  }
  return "Publisher settings now expose the package and profile controls needed to keep catalog pages current.";
}

function entryActionLabel(id: string) {
  if (id === "github-import") return "Try GitHub import";
  if (id === "publisher-workspace") return "Open dashboard";
  if (id === "download-insights") return "View insights";
  if (id === "needs-attention") return "Review issues";
  if (id === "plugin-validation") return "Open fix guide";
  return "Open settings";
}
