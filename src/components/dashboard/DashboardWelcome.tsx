import { Link } from "@tanstack/react-router";
import { Box, Compass, Package, Plus, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { addSearchParams } from "../../lib/addRoutes";
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
          <span className="dashboard-welcome-icon">
            <Sparkles className="h-6 w-6" aria-hidden="true" />
          </span>
          <h1 className="dashboard-welcome-title">Welcome to ClawHub</h1>
          <p className="dashboard-welcome-body">
            You're signed in as <strong>@{ownerHandle}</strong>. Add your first skill or plugin to
            make it available through ClawHub and OpenClaw.
          </p>
        </div>

        <div className="dashboard-welcome-primary">
          <Button asChild size="lg" variant="primary">
            <Link to="/add" search={addSearchParams({ ownerHandle })}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add to ClawHub
            </Link>
          </Button>
        </div>

        <div className="dashboard-welcome-actions">
          <Link
            to="/add"
            search={addSearchParams({ kind: "skill", ownerHandle })}
            className="dashboard-welcome-card"
            aria-label="Add a skill"
          >
            <span className="dashboard-welcome-card-icon">
              <Box className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="dashboard-welcome-card-title">Skill</span>
            <span className="dashboard-welcome-card-desc">
              Reusable instructions and workflows centered around SKILL.md.
            </span>
          </Link>

          <Link
            to="/add"
            search={addSearchParams({ kind: "plugin", ownerHandle })}
            className="dashboard-welcome-card"
            aria-label="Add a plugin"
          >
            <span className="dashboard-welcome-card-icon">
              <Package className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="dashboard-welcome-card-title">Plugin</span>
            <span className="dashboard-welcome-card-desc">
              OpenClaw package, integration, or executable extension.
            </span>
          </Link>

          <Link
            to="/add"
            search={addSearchParams({ kind: "skill", ownerHandle, method: "github" })}
            className="dashboard-welcome-card"
            aria-label="Import from GitHub"
          >
            <span className="dashboard-welcome-card-icon">
              <Compass className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="dashboard-welcome-card-title">Import from GitHub</span>
            <span className="dashboard-welcome-card-desc">
              Bring a public repository into ClawHub in a couple of clicks.
            </span>
          </Link>
        </div>

        <Link to="/skills" search={emptySkillsSearch} className="dashboard-welcome-link">
          <Compass className="h-4 w-4" aria-hidden="true" />
          Browse examples
        </Link>
      </section>
    </main>
  );
}
