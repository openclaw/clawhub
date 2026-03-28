import { formatCompactStat } from "./numberFormat";

/**
 * Build a native tooltip string showing both all-time and current install counts.
 * Displayed on hover over the installs stat in SkillHeader.
 */
export function installsTooltip(allTime: number, current: number): string {
  const allTimeStr = formatCompactStat(allTime);
  const currentStr = formatCompactStat(current);
  return `${allTimeStr} unique users installed · ${currentStr} currently active`;
}
