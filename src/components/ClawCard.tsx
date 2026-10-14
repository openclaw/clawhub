import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Download } from "lucide-react";
import type { ClawListing } from "../lib/clawDiscovery";
import { formatCompactStat } from "../lib/numberFormat";
import { ClawAvatar } from "./ClawAvatar";

export function ClawCard({ claw, featured = false }: { claw: ClawListing; featured?: boolean }) {
  return (
    <Link
      to="/claws/$name"
      params={{ name: claw.name }}
      className={featured ? "claw-feature-card" : "claw-row"}
    >
      <ClawAvatar
        name={claw.name}
        label={claw.displayName}
        imageUrl={claw.icon}
        size={featured ? "featured" : "row"}
      />
      <span className="claw-card-copy">
        <span className="claw-card-title">
          {claw.displayName}
          <ArrowUpRight size={16} aria-hidden="true" />
        </span>
        {featured && claw.ownerHandle ? (
          <span className="claw-card-creator">@{claw.ownerHandle}</span>
        ) : null}
        <span className="claw-card-summary">
          {claw.summary || "A ready-made agent to make your own."}
        </span>
        <span className="claw-card-meta">
          {!featured && claw.ownerHandle ? <span>@{claw.ownerHandle}</span> : null}
          <span>
            <Download size={12} aria-hidden="true" /> {formatCompactStat(claw.stats.downloads)}
            <span className="sr-only"> downloads</span>
          </span>
        </span>
      </span>
    </Link>
  );
}
