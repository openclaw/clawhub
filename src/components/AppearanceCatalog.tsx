import { Link } from "@tanstack/react-router";
import { ArrowRight, Package, Palette, Search, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppearanceSearch } from "../lib/appearance";
import { themeDetailHref } from "../lib/appearance";
import { useAppearanceCatalog } from "../lib/useAppearanceCatalog";
import { BrowseChipTabs } from "./BrowseControls";
import { PluginListItem } from "./PluginListItem";
import { BrowseResultsSkeleton } from "./skeletons/BrowseResultsSkeleton";
import { Button } from "./ui/button";

export function AppearanceCatalog({
  search,
  onNavigate,
}: {
  search: AppearanceSearch;
  onNavigate: (next: AppearanceSearch) => void;
}) {
  const view = search.view ?? "themes";
  const [input, setInput] = useState(search.q ?? "");
  useEffect(() => setInput(search.q ?? ""), [search.q]);
  return (
    <main className="section appearance-page">
      <header className="appearance-heading">
        <span className="appearance-eyebrow">
          <Palette size={16} aria-hidden="true" /> MAKE IT YOURS
        </span>
        <h1>Appearance</h1>
        <p>Find a new look. Give your OpenClaw a little character.</p>
      </header>
      <div className="appearance-toolbar">
        <BrowseChipTabs
          ariaLabel="Appearance type"
          options={[
            { value: "themes", label: "Themes", icon: <Palette size={16} aria-hidden="true" /> },
            {
              value: "packs",
              label: "Lobster Packs",
              icon: <Package size={16} aria-hidden="true" />,
            },
          ]}
          value={view}
          onChange={(value) =>
            onNavigate({ view: value === "packs" ? "packs" : undefined, q: search.q })
          }
        />
        <form
          className="appearance-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            onNavigate({ view: search.view, q: input.trim() || undefined });
          }}
        >
          <Search size={17} aria-hidden="true" />
          <input
            aria-label={view === "themes" ? "Search themes" : "Search Lobster Packs"}
            placeholder={view === "themes" ? "Search themes…" : "Search Lobster Packs…"}
            maxLength={200}
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          {input ? (
            <button
              type="button"
              onClick={() => {
                setInput("");
                onNavigate({ view: search.view });
              }}
            >
              Clear
            </button>
          ) : null}
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
        </form>
      </div>
      <section
        className="appearance-guide"
        aria-label={view === "themes" ? "About themes" : "About Lobster Packs"}
      >
        <ShieldCheck size={23} aria-hidden="true" />
        <div>
          <h2>
            {view === "themes"
              ? "A new look, not new code."
              : "More personality, the familiar plugin path."}
          </h2>
          <p>
            {view === "themes"
              ? "Themes are data-only palettes and built-in branding choices. Open a version to inspect it, then use OpenClaw’s Appearance settings to install."
              : "Lobster Packs are plugin packages for artwork and character. Review each package and its permissions before using the existing plugin installation flow."}
          </p>
        </div>
      </section>
      <AppearanceResults key={view + ":" + (search.q ?? "")} view={view} query={search.q ?? ""} />
    </main>
  );
}

function AppearanceResults({ view, query }: { view: "themes" | "packs"; query: string }) {
  const { page, loading, error, retry, loadMore } = useAppearanceCatalog(view, query);
  const label = view === "themes" ? "themes" : "Lobster Packs";
  return (
    <section aria-label={label + " results"} aria-busy={loading}>
      <div className="appearance-results-heading">
        <h2>
          {query
            ? "Results for “" + query + "”"
            : view === "themes"
              ? "Explore themes"
              : "Explore Lobster Packs"}
        </h2>
        <span>{page?.items.length ? page.items.length + " loaded" : ""}</span>
      </div>
      {error ? (
        <div className="appearance-message" role="alert">
          <h3>Couldn’t load {label}</h3>
          <p>{error}</p>
          <Button variant="secondary" onClick={retry} disabled={loading}>
            Retry
          </Button>
        </div>
      ) : null}
      {loading && !page ? (
        <div role="status" aria-label={"Loading " + label}>
          <BrowseResultsSkeleton variant="grid" count={6} />
        </div>
      ) : null}
      {page?.kind === "themes" ? (
        <div className="appearance-grid">
          {page.items.map((item) => (
            <article className="card appearance-theme-card" key={item.id}>
              <div className="appearance-theme-icon">
                <Palette size={28} aria-hidden="true" />
                <span>Data-only theme</span>
              </div>
              <h3>
                <Link to={themeDetailHref(item)}>{item.name}</Link>
              </h3>
              <span className="appearance-author">
                @{item.author.handle} <span>· v{item.version}</span>
              </span>
              <p>{item.description}</p>
              <Link
                className="appearance-detail-link"
                to={themeDetailHref(item)}
                aria-label={"View " + item.name + " version " + item.version}
              >
                View theme <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </article>
          ))}
        </div>
      ) : page?.kind === "packs" ? (
        <div className="appearance-grid">
          {page.items.map((item) => (
            <PluginListItem key={item.name} item={item} variant="card" />
          ))}
        </div>
      ) : null}
      {!loading && !error && page?.items.length === 0 ? (
        <div className="appearance-message" role="status">
          <Palette size={30} aria-hidden="true" />
          <h3>{query ? "No matching " + label : "No " + label + " to show yet"}</h3>
          <p>
            {page.nextCursor
              ? "More results may be available on the next page."
              : query
                ? "Try another name, description, or publisher."
                : "Check back as publishers add new looks."}
          </p>
        </div>
      ) : null}
      {page?.nextCursor ? (
        <div className="appearance-pagination">
          <Button variant="secondary" disabled={loading} onClick={loadMore}>
            {loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
      {loading && page ? <p role="status">Loading more {label}…</p> : null}
    </section>
  );
}
