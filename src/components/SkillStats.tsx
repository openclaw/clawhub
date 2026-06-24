import { Download, Star } from "lucide-react";
import { formatSkillStatsTriplet, type SkillStatsTriplet } from "../lib/numberFormat";

export function SkillStatsTripletLine({ stats }: { stats: SkillStatsTriplet }) {
  const formatted = formatSkillStatsTriplet(stats);
  return (
    <span className="skill-stats-triplet">
      <span className="skill-stats-item">
        <Star size={14} aria-hidden="true" />
        {formatted.stars}
      </span>
      <span className="skill-stats-item">
        <Download size={14} aria-hidden="true" />
        {formatted.downloads}
      </span>
    </span>
  );
}
