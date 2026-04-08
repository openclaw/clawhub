import { Package } from "lucide-react";
import { formatSkillStatsTriplet, type SkillStatsTriplet } from "../lib/numberFormat";

type SkillMetricsStats = SkillStatsTriplet & {
  versions: number;
};

export function SkillStatsTripletLine({ stats }: { stats: SkillStatsTriplet }) {
  const formatted = formatSkillStatsTriplet(stats);
  return (
    <>
      ⭐ {formatted.stars} · <Package size={13} aria-hidden="true" /> {formatted.downloads}
    </>
  );
}

export function SkillMetricsRow({ stats }: { stats: SkillMetricsStats }) {
  const formatted = formatSkillStatsTriplet(stats);
  return (
    <>
      <span className="inline-flex w-14 items-center justify-end gap-1 tabular-nums">
        <Package size={13} aria-hidden="true" /> {formatted.downloads}
      </span>
      <span className="inline-flex w-14 items-center justify-end gap-1 tabular-nums">
        ★ {formatted.stars}
      </span>
      <span className="inline-flex w-14 items-center justify-end gap-1 tabular-nums">
        {stats.versions} v
      </span>
    </>
  );
}
