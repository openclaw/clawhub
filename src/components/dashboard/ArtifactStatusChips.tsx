import { Fragment, type ReactNode } from "react";
import { familyLabel } from "../../lib/packageLabels";
import type { DashboardPackage, DashboardSkill } from "./types";
import {
  packageSecurityStatus,
  packageVisibilityStatus,
  skillSecurityStatus,
  skillVisibilityStatus,
  type StatusChip,
} from "./artifactStatusLabels";

export function SkillCatalogMeta({ skill }: { skill: DashboardSkill }) {
  return (
    <CatalogRowMeta
      kindLabel="Skill"
      security={skillSecurityStatus(skill)}
      visibility={skillVisibilityStatus(skill)}
    />
  );
}

export function PackageCatalogMeta({ pkg }: { pkg: DashboardPackage }) {
  const family =
    pkg.family === "code-plugin" || pkg.family === "bundle-plugin"
      ? familyLabel(pkg.family)
      : null;

  return (
    <CatalogRowMeta
      kindLabel="Plugin"
      familyLabel={family}
      security={packageSecurityStatus(pkg)}
      visibility={packageVisibilityStatus(pkg)}
    />
  );
}

type CatalogRowMetaProps = {
  kindLabel: string;
  familyLabel?: string | null;
  security: StatusChip;
  visibility: StatusChip;
};

function CatalogRowMeta({
  kindLabel,
  familyLabel,
  security,
  visibility,
}: CatalogRowMetaProps) {
  const segments: Array<{ key: string; node: ReactNode }> = [
    { key: "kind", node: <span className="dashboard-catalog-kind">{kindLabel}</span> },
  ];

  if (familyLabel) {
    segments.push({ key: "family", node: <span>{familyLabel}</span> });
  }

  for (const chip of pickVisibleStatuses(security, visibility)) {
    segments.push({
      key: chip.label,
      node: (
        <span className={`dashboard-catalog-status is-${chip.tone}`}>{chip.label}</span>
      ),
    });
  }

  return (
    <p className="dashboard-catalog-row-details">
      {segments.map((segment, index) => (
        <Fragment key={segment.key}>
          {index > 0 ? (
            <span className="dashboard-catalog-sep" aria-hidden="true">
              ·
            </span>
          ) : null}
          {segment.node}
        </Fragment>
      ))}
    </p>
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
