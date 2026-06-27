import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
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
    (entry) => surface === "All" || entry.surfaces.includes(surface),
  );

  useEffect(() => {
    const openAnchoredEntry = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (PLATFORM_CHANGELOG_ENTRIES.some((entry) => entry.id === id)) {
        setSurface("All");
        setExpandedEntryId(id);
      }
    };

    openAnchoredEntry();
    window.addEventListener("hashchange", openAnchoredEntry);
    return () => window.removeEventListener("hashchange", openAnchoredEntry);
  }, []);

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
              <time dateTime={entry.iso}>{entry.when}</time>
            </div>
            <div className="changelog-entry-body">
              <h2>{entry.title}</h2>
              <p>{entry.summary}</p>
              {expandedEntryId === entry.id ? (
                <div className="changelog-entry-expanded">
                  <p>{entry.details}</p>
                  {entry.to ? (
                    <Link to={entry.to} search={entry.search} className="changelog-entry-link">
                      {entry.actionLabel}
                    </Link>
                  ) : entry.href ? (
                    <a
                      href={entry.href}
                      className="changelog-entry-link"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {entry.actionLabel}
                      <ArrowUpRight size={13} aria-hidden="true" />
                    </a>
                  ) : null}
                  <button
                    type="button"
                    className="changelog-entry-read-more"
                    onClick={() => setExpandedEntryId(null)}
                  >
                    Show less −
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="changelog-entry-read-more"
                  onClick={() => setExpandedEntryId(entry.id)}
                >
                  Read more +
                </button>
              )}
            </div>
          </article>
        ))}
        {visibleEntries.length === 0 ? (
          <p className="changelog-empty">No {surface} updates yet.</p>
        ) : null}
      </section>

      <section className="changelog-art" aria-label="Changelog artwork">
        <img
          src="https://wander-bonnet-3cat.here.now/droppie-2026-06-27T18-55-59Z.png"
          alt=""
          className="changelog-art-image"
          draggable={false}
        />
      </section>
    </main>
  );
}
