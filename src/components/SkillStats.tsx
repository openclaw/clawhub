import { Download } from "lucide-react";
import { formatSkillStatsTriplet, type SkillStatsTriplet } from "../lib/numberFormat";

type SkillMetricsStats = SkillStatsTriplet & {
  versions: number;
};

export function SkillStatsTripletLine({ stats }: { stats: SkillStatsTriplet }) {
  const formatted = formatSkillStatsTriplet(stats);
  return (
    <>
      <Download size={13} aria-hidden="true" /> {formatted.downloads} · ⭐ {formatted.stars}
    </>
  );
}

export function SkillMetricsRow({ stats }: { stats: SkillMetricsStats }) {
  const formatted = formatSkillStatsTriplet(stats);
  return (
    <>
      <span>
        <Download size={13} aria-hidden="true" /> {formatted.downloads}
      </span>
      <span>⭐ {formatted.stars}</span>
      <span>{stats.versions} v</span>
    </>
  );
}
