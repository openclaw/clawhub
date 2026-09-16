import { expect, it } from "vitest";
import { mondaySearchWeek } from "./searchDigest";

it.each([
  ["2026-03-02T16:59:00Z", null],
  ["2026-03-02T17:00:00Z", "2026-03-02T00:00:00Z"],
  ["2026-03-09T15:59:00Z", null],
  ["2026-03-09T16:00:00Z", "2026-03-09T00:00:00Z"],
  ["2026-11-02T17:00:00Z", "2026-11-02T00:00:00Z"],
  ["2026-09-08T17:00:00Z", null],
])("Monday 09:00 Pacific schedule at %s identifies the completed UTC week", (now, end) => {
  expect(mondaySearchWeek(Date.parse(now!))).toEqual(
    end
      ? {
          weekStart: Date.parse(end) - 604_800_000,
          weekEnd: Date.parse(end),
        }
      : null,
  );
});
