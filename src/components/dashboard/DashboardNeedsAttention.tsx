import { Link } from "@tanstack/react-router";
import type { DashboardAttentionItem } from "./types";

const ATTENTION_STRIP_LIMIT = 5;

type DashboardNeedsAttentionProps = {
  items: DashboardAttentionItem[];
};

export function DashboardNeedsAttention({ items }: DashboardNeedsAttentionProps) {
  if (items.length === 0) return null;

  const visibleItems = items.slice(0, ATTENTION_STRIP_LIMIT);

  return (
    <section className="dashboard-attention-strip" aria-label="Needs attention">
      <header className="dashboard-section-head dashboard-attention-strip-header">
        <div className="dashboard-section-head-main">
          <h2 className="dashboard-section-title">Needs attention</h2>
          <span className="dashboard-section-count">{items.length}</span>
        </div>
        {items.length > ATTENTION_STRIP_LIMIT ? (
          <Link
            to="/dashboard"
            search={{ kind: "attention" }}
            className="dashboard-attention-view-all"
          >
            View all ({items.length})
          </Link>
        ) : null}
      </header>
      <div className="results-list">
        {visibleItems.map((item) => {
          const context = attentionContextLine(item);
          return (
            <a
              key={item.id}
              href={item.href}
              className="skill-list-item skill-list-item-no-icon dashboard-attention-row"
              aria-label={attentionRowLabel(item, context)}
            >
              <div className="skill-list-item-body">
                <div className="skill-list-item-main dashboard-attention-title-row">
                  <span className={`dashboard-attention-badge is-${item.severity}`}>
                    {severityLabel(item.severity)}
                  </span>
                  <span className="skill-list-item-name">{item.title}</span>
                </div>
                {context ? (
                  <p className="skill-list-item-summary dashboard-attention-context">{context}</p>
                ) : null}
              </div>
              <div className="skill-list-item-meta">
                <span className="dashboard-attention-cta">{item.actionLabel}</span>
              </div>
            </a>
          );
        })}
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

function isReasonRedundantWithBadge(
  reason: string,
  severity: DashboardAttentionItem["severity"],
) {
  const normalized = reason.trim().toLowerCase();
  if (severity === "destructive") {
    return normalized === "blocked by security checks" || normalized === "blocked";
  }
  if (severity === "pending") {
    return normalized === "waiting for security checks";
  }
  return normalized === "needs security review";
}

function attentionContextLine(item: DashboardAttentionItem) {
  const kind = kindLabel(item.kind);
  const preview = item.preview?.trim();
  const reasonRedundant = isReasonRedundantWithBadge(item.reason, item.severity);

  if (preview) return `${kind} · ${preview}`;
  if (!reasonRedundant) return `${kind} · ${item.reason}`;
  return kind;
}

function attentionRowLabel(item: DashboardAttentionItem, context: string | null) {
  const parts = [item.title, severityLabel(item.severity), item.reason];
  if (context) parts.push(context);
  return parts.join(". ");
}
