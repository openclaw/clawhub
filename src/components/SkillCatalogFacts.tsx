import type { NormalizedSecurityStatus } from "clawhub-schema/securityAudit";
import { CatalogDetailFact, useCatalogDateFormatter } from "./CatalogDetailLayout";

const verdicts = {
  clean: { label: "Clean", bars: 3 },
  suspicious: { label: "Review", bars: 2 },
  malicious: { label: "Blocked", bars: 1 },
  pending: { label: "Pending", bars: 0 },
  error: { label: "Error", bars: 0 },
} satisfies Record<NormalizedSecurityStatus, { label: string; bars: number }>;

// Counterpart of Control UI's ClawHubSkillPage (discovered, not installed skills).
export function SkillCatalogFacts({
  status,
  auditHref,
  version,
  updatedAt,
  license,
  platforms,
}: {
  status?: NormalizedSecurityStatus | null;
  auditHref?: string;
  version?: string;
  updatedAt?: number | null;
  license?: string | null;
  platforms?: string[];
}) {
  const dateFormatter = useCatalogDateFormatter();
  const date = typeof updatedAt === "number" ? new Date(updatedAt) : null;
  const updated = date && Number.isFinite(date.valueOf()) ? date : null;
  const verdict = status && verdicts[status];
  // Registry snapshots no longer carry a VirusTotal URL. Preserve the local audit
  // destination on the verdict itself without implying an external report exists.
  const Score = auditHref ? "a" : "span";
  if (!verdict && !version && !updated && !license && !platforms?.length) return null;
  return (
    <div className="skill-catalog-facts" role="group" aria-label="Skill metadata">
      {verdict && (
        <CatalogDetailFact label="Security check">
          <Score
            className="skill-catalog-security-score"
            href={auditHref}
            aria-label={auditHref ? `Full security report: ${verdict.label}` : undefined}
            title={auditHref ? "Full security report" : undefined}
          >
            <span>{verdict.label}</span>
            <span className="security-audit-meter" data-level={verdict.bars} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </Score>
        </CatalogDetailFact>
      )}
      {version && <CatalogDetailFact label="Version">{version}</CatalogDetailFact>}
      {updated && (
        <CatalogDetailFact label="Updated">
          <time dateTime={updated.toISOString()}>{dateFormatter.format(updated)}</time>
        </CatalogDetailFact>
      )}
      {license && <CatalogDetailFact label="License">{license}</CatalogDetailFact>}
      {platforms?.length ? (
        <CatalogDetailFact label="Platforms">
          {platforms.map((os) => (
            <span className="skill-catalog-chip" key={os}>
              {os}
            </span>
          ))}
        </CatalogDetailFact>
      ) : null}
    </div>
  );
}
