import { Download } from "lucide-react";
import { formatSoulStatsTriplet, type SoulStatsTriplet } from "../lib/numberFormat";

export function SoulStatsTripletLine({
  stats,
  versionSuffix = "v",
}: {
  stats: SoulStatsTriplet;
  versionSuffix?: "v" | "versions";
}) {
  const formatted = formatSoulStatsTriplet(stats);
  return (
    <>
      <Download size={13} aria-hidden="true" /> {formatted.downloads} · ⭐ {formatted.stars} ·{" "}
      {formatted.versions} {versionSuffix}
    </>
  );
}

export function SoulMetricsRow({ stats }: { stats: SoulStatsTriplet }) {
  const formatted = formatSoulStatsTriplet(stats);
  return (
    <>
      <span>
        <Download size={13} aria-hidden="true" /> {formatted.downloads}
      </span>
      <span>⭐ {formatted.stars}</span>
      <span>{formatted.versions} v</span>
    </>
  );
}
