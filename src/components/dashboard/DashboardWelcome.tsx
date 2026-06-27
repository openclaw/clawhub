import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Compass, Package, Plug, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { addSearchParams } from "../../lib/addRoutes";
import { CLAWHUB_DOCS_URL } from "../../lib/publicRegistry";
import { Button } from "../ui/button";

const emptySkillsSearch = {
  q: undefined,
  sort: undefined,
  dir: undefined,
  highlighted: undefined,
  view: undefined,
  focus: undefined,
} as const;

type DashboardWelcomeProps = {
  ownerHandle: string;
  publisherSelector: ReactNode;
};

export function DashboardWelcome({ ownerHandle, publisherSelector }: DashboardWelcomeProps) {
  return (
    <main className="section dashboard-route dashboard-route--welcome">
      {publisherSelector ? (
        <div className="dashboard-welcome-toolbar">{publisherSelector}</div>
      ) : null}

      <section className="dashboard-welcome">
        <div className="dashboard-welcome-hero">
          <span className="dashboard-welcome-icon" aria-hidden="true">
            <span className="dashboard-welcome-icon-tile dashboard-welcome-icon-tile--back dashboard-welcome-icon-tile--package">
              <Package className="h-4 w-4" />
            </span>
            <span className="dashboard-welcome-icon-tile dashboard-welcome-icon-tile--back dashboard-welcome-icon-tile--plugin">
              <Plug className="h-4 w-4" />
            </span>
            <span className="dashboard-welcome-icon-tile dashboard-welcome-icon-tile--brand">
              <img src="/logo-transparent.png" alt="" draggable={false} />
            </span>
          </span>
          <h1 className="dashboard-welcome-title">Welcome to ClawHub</h1>
          <p className="dashboard-welcome-body">
            Publish your first skill or plugin for others to discover and use.
          </p>
        </div>

        <div className="dashboard-welcome-primary">
          <Button asChild size="lg" variant="primary">
            <Link to="/add" search={addSearchParams({ ownerHandle })}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add skill or plugin
            </Link>
          </Button>
        </div>

        <div className="dashboard-welcome-explore">
          <span className="dashboard-welcome-explore-label">
            <Compass className="h-3.5 w-3.5" aria-hidden="true" />
            Or explore ClawHub
          </span>
          <nav className="dashboard-welcome-explore-links" aria-label="Explore ClawHub">
            <Link to="/skills" search={emptySkillsSearch}>Skills</Link>
            <Link to="/plugins">Plugins</Link>
            <Link to="/creators">Creators</Link>
            <a href={CLAWHUB_DOCS_URL} target="_blank" rel="noreferrer">
              Docs
              <ArrowUpRight size={12} aria-hidden="true" />
            </a>
          </nav>
        </div>
      </section>
    </main>
  );
}
