import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";

const sortKeys = ["newest", "downloads", "stars", "name", "updated"] as const;
type SortKey = (typeof sortKeys)[number];
function parseSort(value: unknown): SortKey {
  if (typeof value !== "string") return "newest";
  if ((sortKeys as readonly string[]).includes(value)) return value as SortKey;
  return "newest";
}

export const Route = createFileRoute("/souls/")({
  validateSearch: (search) => {
    return {
      q: typeof search.q === "string" && search.q.trim() ? search.q : undefined,
      sort: typeof search.sort === "string" ? parseSort(search.sort) : undefined,
      dir: search.dir === "asc" || search.dir === "desc" ? search.dir : undefined,
      view: search.view === "cards" || search.view === "list" ? search.view : undefined,
      focus: search.focus === "search" ? "search" : undefined,
    };
  },
  component: SoulsHoldingPage,
});

function SoulsHoldingPage() {
  return (
    <main className="section souls-coming-page">
      <section className="souls-coming-hero">
        <div>
          <div className="skill-card-tags mb-3">
            <Badge>Souls</Badge>
            <Badge variant="accent">Coming soon</Badge>
          </div>
          <h1 className="about-title">SOUL.md discovery is on deck</h1>
          <p className="about-lead">
            This page is the holding area for public SOUL.md profiles you’ll be able to discover,
            compare, and share. We’re not shipping a half-baked directory just to tick a box.
          </p>
        </div>
        <div className="souls-coming-grid">
          <article className="about-rule-card">
            <h2>Discover</h2>
            <p>Browse public system personas, writing voices, and full character sheets.</p>
          </article>
          <article className="about-rule-card">
            <h2>Share</h2>
            <p>Publish versioned SOUL.md files with attribution and clean history.</p>
          </article>
          <article className="about-rule-card">
            <h2>Compare</h2>
            <p>Inspect changes, stats, and adoption without the usual metadata sludge.</p>
          </article>
        </div>
      </section>

      <section className="about-enforcement">
        <div>
          <span className="about-callout-label">In the meantime</span>
          <p className="about-lead mb-0">
            ClawHub already handles skills and plugins. Souls will get the same discovery treatment
            once the publishing flow is ready.
          </p>
        </div>
        <div className="skill-card-tags">
          <Button asChild variant="primary">
            <Link to="/skills" search={{ q: undefined, sort: "downloads", dir: "desc", highlighted: undefined, nonSuspicious: true, view: undefined, focus: undefined }}>
              Browse Skills
            </Link>
          </Button>
          <Button asChild>
            <Link to="/users" search={{ q: undefined }}>
              Browse Users
            </Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
