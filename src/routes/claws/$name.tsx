import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Download } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { ClawAvatar } from "../../components/ClawAvatar";
import { convexHttp } from "../../convex/client";
import { clawCategoryLabel } from "../../lib/clawDiscovery";
import { formatCompactStat } from "../../lib/numberFormat";
import { buildPublisherProfileHref } from "../../lib/ownerRoute";
import "../../claws.css";

export const Route = createFileRoute("/claws/$name")({
  loader: async ({ params }) => {
    const result = await convexHttp.query(api.packages.getByName, { name: params.name });
    if (!result || result.package.family !== "claw") throw notFound();
    return result;
  },
  pendingComponent: () => (
    <main className="claw-container claw-state" role="status">
      Loading Claw…
    </main>
  ),
  errorComponent: ClawDetailError,
  notFoundComponent: () => (
    <main className="claw-container claw-state">
      <h1>Claw not found</h1>
      <p>This Claw may no longer be available.</p>
      <Link to="/claws">Explore Claws</Link>
    </main>
  ),
  component: ClawDetail,
});

function ClawDetailError() {
  const router = useRouter();
  return (
    <main className="claw-container claw-state" role="alert">
      <h1>This Claw couldn’t load</h1>
      <button className="btn" type="button" onClick={() => void router.invalidate()}>
        Try again
      </button>
    </main>
  );
}

function ClawDetail() {
  const { package: claw, owner } = Route.useLoaderData();
  const summary = claw.clawManifestSummary;
  return (
    <main className="claw-container claw-detail">
      <Link to="/claws" className="claw-text-link">
        <ArrowLeft size={16} aria-hidden="true" /> All Claws
      </Link>
      <header className="claw-detail-header">
        <ClawAvatar name={claw.name} label={claw.displayName} imageUrl={claw.icon} size="detail" />
        <div>
          <span className="oc-eyebrow">Claw</span>
          <h1>{claw.displayName}</h1>
          {owner?.handle ? (
            <Link to={buildPublisherProfileHref(owner.handle)} className="claw-text-link">
              by @{owner.handle}
            </Link>
          ) : null}
          <p>{claw.summary}</p>
          <div className="claw-card-meta">
            <span>
              <Download size={14} aria-hidden="true" /> {formatCompactStat(claw.stats.downloads)}{" "}
              downloads
            </span>
            {claw.latestVersion ? <span>v{claw.latestVersion}</span> : null}
          </div>
        </div>
      </header>
      <nav className="claw-category-nav" aria-label="Claw categories">
        {claw.categories?.map((category) => (
          <Link to="/claws" search={{ category }} key={category}>
            {clawCategoryLabel(category)}
          </Link>
        ))}
      </nav>
      {summary ? (
        <section className="claw-detail-about">
          <h2>Meet {summary.agent.name || claw.displayName}</h2>
          <p>{summary.agent.description || claw.summary}</p>
          <h3>Inside this Claw</h3>
          <dl className="claw-detail-stats">
            <div>
              <dt>Skills</dt>
              <dd>{summary.packages.skillCount}</dd>
            </div>
            <div>
              <dt>Plugins</dt>
              <dd>{summary.packages.pluginCount}</dd>
            </div>
            <div>
              <dt>MCP servers</dt>
              <dd>{summary.mcpServerCount}</dd>
            </div>
            <div>
              <dt>Scheduled jobs</dt>
              <dd>{summary.cronJobCount}</dd>
            </div>
          </dl>
          {summary.workspace.bootstrapFiles.length ? (
            <p>Instructions: {summary.workspace.bootstrapFiles.join(", ")}</p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
