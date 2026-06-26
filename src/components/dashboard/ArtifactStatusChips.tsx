import type { StatusChip } from "./artifactStatusLabels";

export function CatalogRowKindLine({
  kindLabel,
  familyLabel: pluginFamily,
}: {
  kindLabel: string;
  familyLabel?: string | null;
}) {
  return (
    <p className="dashboard-catalog-row-kind">
      <span className="dashboard-catalog-kind">{kindLabel}</span>
      {pluginFamily ? (
        <>
          <span className="dashboard-catalog-sep" aria-hidden="true">
            ·
          </span>
          <span>{pluginFamily}</span>
        </>
      ) : null}
    </p>
  );
}

export function CatalogRowStatusColumn({
  security,
  visibility,
}: {
  security: StatusChip;
  visibility: StatusChip;
}) {
  const chips = pickVisibleStatuses(security, visibility);
  if (chips.length === 0) {
    return <div className="skill-list-item-taxonomy" aria-hidden="true" />;
  }

  return (
    <div className="skill-list-item-taxonomy" aria-label="Status">
      {chips.map((chip) => (
        <span key={chip.label} className={`dashboard-catalog-status is-${chip.tone}`}>
          {chip.label}
        </span>
      ))}
    </div>
  );
}

function pickVisibleStatuses(security: StatusChip, visibility: StatusChip) {
  const chips: StatusChip[] = [];

  if (shouldShowSecurityStatus(security)) {
    chips.push(security);
  }
  if (shouldShowVisibilityStatus(visibility)) {
    chips.push(visibility);
  }

  return chips;
}

function shouldShowSecurityStatus(chip: StatusChip) {
  if (chip.label === "Scan passed" || chip.label === "Not scanned") return false;
  return chip.tone !== "muted";
}

function shouldShowVisibilityStatus(chip: StatusChip) {
  return chip.label !== "Public";
}
