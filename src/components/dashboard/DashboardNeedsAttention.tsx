import { Link } from "@tanstack/react-router";
import type { DashboardAttentionItem } from "./types";

const ATTENTION_STRIP_LIMIT = 3;

type DashboardNeedsAttentionProps = {
  items: DashboardAttentionItem[];
};

export function DashboardNeedsAttention({ items }: DashboardNeedsAttentionProps) {
  if (items.length === 0) return null;

  const visibleItems = items.slice(0, ATTENTION_STRIP_LIMIT);

  return (
    <section className="dashboard-attention-strip" aria-label="Needs attention">
      <div className="dashboard-attention-strip-header">
        <h2 className="browse-list-head-label dashboard-attention-strip-label">Needs attention</h2>
        {items.length > ATTENTION_STRIP_LIMIT ? (
          <Link
            to="/dashboard"
            search={{ kind: "attention" }}
            className="dashboard-attention-view-all"
          >
            View all ({items.length})
          </Link>
        ) : null}
      </div>
      <div className="results-list">
        {visibleItems.map((item) => (
          <a
            key={item.id}
            href={item.href}
            className="skill-list-item skill-list-item-no-icon dashboard-attention-row"
          >
            <div className="skill-list-item-body">
              <div className="skill-list-item-main dashboard-attention-title-row">
                <span className={`dashboard-attention-badge is-${item.severity}`}>
                  {severityLabel(item.severity)}
                </span>
                <span className="skill-list-item-name">{item.title}</span>
              </div>
              <p className="dashboard-catalog-row-details">
                <span className="dashboard-catalog-kind">{kindLabel(item.kind)}</span>
                <span className="dashboard-catalog-sep" aria-hidden="true">
                  ·
                </span>
                <span className={`dashboard-catalog-status is-${item.severity}`}>
                  {severityLabel(item.severity)}
                </span>
              </p>
              <p className="skill-list-item-summary dashboard-attention-context">
                {item.preview ? `${item.reason} · ${item.preview}` : item.reason}
              </p>
            </div>
            <div className="skill-list-item-meta">
              <span className="dashboard-attention-cta">{item.actionLabel}</span>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

function kindLabel(kind: DashboardAttentionItem["kind"]) {
  return kind === "skill" ? "Skill" : "Plugin";
}

function severityLabel(severity: DashboardAttentionItem["severity"]) {
  if (severity === "destructive") return "Blocked";
  if (severity === "pending") return "Pending";
  return "Review";
}
