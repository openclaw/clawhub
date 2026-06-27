import type { ReactNode } from "react";
import type { StatusChip } from "./artifactStatusLabels";

export function CatalogRowStatusColumn({
  security,
  children,
}: {
  security: StatusChip;
  children?: ReactNode;
}) {
  const chips = pickVisibleStatuses(security);
  if (chips.length === 0 && !children) {
    return <div className="skill-list-item-taxonomy" aria-hidden="true" />;
  }

  return (
    <div className="skill-list-item-taxonomy" aria-label="Status">
      {chips.map((chip) => (
        <span key={chip.label} className={`dashboard-catalog-status is-${chip.tone}`}>
          {chip.label}
        </span>
      ))}
      {children}
    </div>
  );
}

function pickVisibleStatuses(security: StatusChip) {
  const chips: StatusChip[] = [];

  if (shouldShowSecurityStatus(security)) {
    chips.push(security);
  }

  return chips;
}

function shouldShowSecurityStatus(chip: StatusChip) {
  if (chip.label === "Scan passed" || chip.label === "Not scanned") return false;
  return chip.tone !== "muted";
}
