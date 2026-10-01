/** Completed UTC week, released on Monday at/after 09:00 America/Los_Angeles. */
export function mondaySearchWeek(now: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  if (value("weekday") !== "Mon" || Number(value("hour")) < 9) return null;
  const weekEnd = Date.UTC(Number(value("year")), Number(value("month")) - 1, Number(value("day")));
  return { weekStart: weekEnd - 7 * 24 * 60 * 60 * 1000, weekEnd };
}
