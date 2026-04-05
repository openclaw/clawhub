import { Package } from "lucide-react";
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
      ⭐ {formatted.stars} · <Package size={13} aria-hidden="true" /> {formatted.downloads} ·{" "}
      {formatted.versions} {versionSuffix}
    </>
  );
}

export function SoulMetricsRow({ stats }: { stats: SoulStatsTriplet }) {
  const formatted = formatSoulStatsTriplet(stats);
  return (
    <>
      <span>
        <Package size={13} aria-hidden="true" /> {formatted.downloads}
      </span>
      <span>★ {formatted.stars}</span>
      <span>{formatted.versions} v</span>
    </>
  );
}
