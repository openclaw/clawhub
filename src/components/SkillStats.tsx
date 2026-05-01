import { ArrowDownToLine } from "lucide-react";
import { formatSkillStatsTriplet, type SkillStatsTriplet } from "../lib/numberFormat";

export function SkillStatsTripletLine({ stats }: { stats: SkillStatsTriplet }) {
  const formatted = formatSkillStatsTriplet(stats);
  return (
    <>
      ⭐ {formatted.stars} · <ArrowDownToLine size={13} aria-hidden="true" /> {formatted.downloads}
    </>
  );
}
