import { describe, expect, it } from "vitest";
import type { Doc } from "./_generated/dataModel";
import { decideSeedStart } from "./seed";

function seedState(cursor: string, updatedAt: number) {
  return { cursor, updatedAt } as unknown as Doc<"githubBackupSyncState">;
}

describe("decideSeedStart", () => {
  it("returns done when done", () => {
    expect(decideSeedStart(seedState("done", Date.now()), Date.now())).toEqual({
      started: false,
      reason: "done",
    });
  });

  it("returns running when lock fresh", () => {
    const now = Date.now();
    expect(decideSeedStart(seedState("running", now), now + 1000)).toEqual({
      started: false,
      reason: "running",
    });
  });

  it("starts when lock stale", () => {
    const now = Date.now();
    const stale = now - 10 * 60 * 1000 - 1;
    expect(decideSeedStart(seedState("running", stale), now)).toEqual({
      started: true,
      reason: "patched",
    });
  });

  it("starts when missing", () => {
    expect(decideSeedStart(null, Date.now())).toEqual({ started: true, reason: "inserted" });
  });
});
