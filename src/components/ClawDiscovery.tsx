import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Search } from "lucide-react";
import { useEffect, useState } from "react";
import {
  clawCategoryLabel,
  fetchClawDiscovery,
  filterClaws,
  popularClawCategories,
  type ClawDiscovery as Discovery,
} from "../lib/clawDiscovery";
import { ClawCard } from "./ClawCard";

export function ClawSearch({ query = "", category }: { query?: string; category?: string }) {
  const navigate = useNavigate();
  return (
    <form
      action="/claws"
      role="search"
      className="claw-search"
      onSubmit={(event) => {
        event.preventDefault();
        const submittedQuery = new FormData(event.currentTarget).get("q");
        void navigate({
          to: "/claws",
          search: { q: typeof submittedQuery === "string" ? submittedQuery : undefined, category },
        });
      }}
    >
      <Search size={20} aria-hidden="true" />
      <input
        key={query}
        type="search"
        name="q"
        defaultValue={query}
        placeholder="Find a Claw for…"
        aria-label="Search Claws"
      />
      {category ? <input type="hidden" name="category" value={category} /> : null}
      <button type="submit" aria-label="Submit Claw search">
        <ArrowRight size={20} aria-hidden="true" />
      </button>
    </form>
  );
}

export function ClawDiscovery({
  initialData,
  browse = false,
  query = "",
  category,
}: {
  initialData: Discovery | null;
  browse?: boolean;
  query?: string;
  category?: string;
}) {
  const [data, setData] = useState(initialData);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (initialData) {
      setData(initialData);
      setFailed(false);
      return () => {};
    }
    let active = true;
    setFailed(false);
    void fetchClawDiscovery().then(
      (result) => {
        if (active) setData(result);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [initialData, attempt]);

  if (failed)
    return (
      <section className="claw-state" role="alert">
        <h2>Claws couldn’t load</h2>
        <p>Please try again in a moment.</p>
        <button type="button" className="btn" onClick={() => setAttempt((value) => value + 1)}>
          Try again
        </button>
      </section>
    );
  if (!data)
    return (
      <section className="claw-loading" aria-label="Loading Claws" aria-busy="true">
        <span role="status">Finding your next Claw…</span>
        <div className="claw-feature-grid">
          {[0, 1, 2, 3].map((key) => (
            <div className="claw-skeleton" key={key} />
          ))}
        </div>
        <div className="claw-category-grid">
          {[0, 1, 2, 3, 4, 5].map((key) => (
            <div className="claw-skeleton claw-skeleton-category" key={key} />
          ))}
        </div>
      </section>
    );
  if (!data.items.length)
    return (
      <section className="claw-state">
        <span className="oc-eyebrow">A new chapter</span>
        <h2>The Claw collection is on its way.</h2>
        <p>
          Claws are ready-made agents with their own instructions and tools. Check back as creators
          publish their first Claws.
        </p>
        <Link to="/skills" className="claw-text-link">
          Explore skills <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </section>
    );
  const categories = popularClawCategories(data.items);
  const results = filterClaws(data.items, query, category);
  if (browse)
    return (
      <section className="claw-browse-results" aria-label="Claw results">
        <nav className="claw-category-nav" aria-label="Claw categories">
          <Link
            to="/claws"
            search={{ q: query || undefined }}
            aria-current={!category ? "page" : undefined}
          >
            All Claws
          </Link>
          {categories.map((group) => (
            <Link
              key={group.slug}
              to="/claws"
              search={{ category: group.slug, q: query || undefined }}
              aria-current={category === group.slug ? "page" : undefined}
            >
              {clawCategoryLabel(group.slug)}
            </Link>
          ))}
        </nav>
        <p className="claw-result-count" role="status">
          {results.length} {results.length === 1 ? "Claw" : "Claws"}
          {query ? ` matching “${query}”` : ""}
        </p>
        {results.length ? (
          <div className="claw-category-grid">
            {results.map((claw) => (
              <ClawCard key={claw.name} claw={claw} />
            ))}
          </div>
        ) : (
          <div className="claw-state">
            <h2>No Claws found</h2>
            <p>Try a different search or explore another category.</p>
            <Link to="/claws" className="claw-text-link">
              See all Claws <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        )}
      </section>
    );
  return (
    <>
      <section className="claw-featured" aria-labelledby="featured-claws">
        <header className="claw-section-head">
          <div>
            <span className="oc-eyebrow">Worth a closer look</span>
            <h2 id="featured-claws">Featured Claws</h2>
          </div>
          <Link className="claw-text-link" to="/claws">
            See every Claw <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </header>
        {data.featured.length ? (
          <div className="claw-feature-grid">
            {data.featured.map((claw) => (
              <ClawCard key={claw.name} claw={claw} featured />
            ))}
          </div>
        ) : (
          <p className="claw-inline-empty">
            Our featured collection is coming soon. Explore the catalog below.
          </p>
        )}
      </section>
      <section
        className="claw-categories"
        id="categories"
        aria-labelledby="popular-claw-categories"
      >
        <header className="claw-section-head">
          <div>
            <span className="oc-eyebrow">Find your kind of help</span>
            <h2 id="popular-claw-categories">Popular categories</h2>
            <p>Explore by purpose. Ranked by all-time Claw downloads.</p>
          </div>
        </header>
        {categories.length ? (
          <div className="claw-category-grid">
            {categories.slice(0, 6).map((group, index) => (
              <section key={group.slug} className="claw-category">
                <header>
                  <span className="claw-category-number">{String(index + 1).padStart(2, "0")}</span>
                  <h3>
                    <Link to="/claws" search={{ category: group.slug }}>
                      {clawCategoryLabel(group.slug)}
                    </Link>
                  </h3>
                  <Link
                    to="/claws"
                    search={{ category: group.slug }}
                    aria-label={`See all ${clawCategoryLabel(group.slug)} Claws`}
                    className="claw-category-more"
                  >
                    <ArrowRight size={18} aria-hidden="true" />
                  </Link>
                </header>
                <div>
                  {group.items.slice(0, 4).map((claw) => (
                    <ClawCard key={claw.name} claw={claw} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="claw-inline-empty">
            <p>Categories are coming as the collection grows.</p>
            <Link className="claw-text-link" to="/claws">
              Browse all Claws <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        )}
      </section>
    </>
  );
}
