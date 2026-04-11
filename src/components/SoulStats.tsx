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
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center gap-0.5">⭐ {formatted.stars}</span>
      <span className="opacity-40">·</span>
      <span className="inline-flex items-center gap-0.5">
        <Package size={13} aria-hidden="true" /> {formatted.downloads}
      </span>
      <span className="opacity-40">·</span>
      <span>{formatted.versions} {versionSuffix}</span>
    </span>
  );
}

export function SoulMetricsRow({ stats }: { stats: SoulStatsTriplet }) {
  const formatted = formatSoulStatsTriplet(stats);
  return (
    <>
      <span className="inline-flex w-14 items-center justify-end gap-1 tabular-nums">
        <Package size={13} aria-hidden="true" /> {formatted.downloads}
      </span>
      <span className="inline-flex w-14 items-center justify-end gap-1 tabular-nums">
        ★ {formatted.stars}
      </span>
      <span className="inline-flex w-14 items-center justify-end gap-1 tabular-nums">
        {formatted.versions} v
      </span>
    </>
  );
}
