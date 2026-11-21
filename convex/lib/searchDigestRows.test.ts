/* @vitest-environment node */

import type { WithoutSystemFields } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import type { Doc, Id, TableNames } from "../_generated/dataModel";
import { hasDigestChanged, reconcileSearchDigestRows } from "./searchDigestRows";

type Fields = WithoutSystemFields<Doc<"skillTopicSearchDigest">>;

function fields(topic: string, updatedAt = 2): Fields {
  return { skillId: "skills:fixture" as Id<"skills">, topic, createdAt: 1, updatedAt };
}

function row(topic: string, id = topic, updatedAt = 2): Doc<"skillTopicSearchDigest"> {
  return { ...fields(topic, updatedAt), _id: id as Id<"skillTopicSearchDigest">, _creationTime: 1 };
}

function writer() {
  const db = {
    async delete() {},
    async patch() {},
    async insert<Table extends TableNames>(): Promise<Id<Table>> {
      return "inserted" as Id<Table>;
    },
  };
  return {
    db,
    insert: vi.spyOn(db, "insert"),
    patch: vi.spyOn(db, "patch"),
    deleteRow: vi.spyOn(db, "delete"),
  };
}

describe("search digest rows", () => {
  it("keeps no-op writes suppressed while comparing only supplied fields", () => {
    expect(hasDigestChanged({ values: ["a", "b"], extra: 1 }, { values: ["a", "b"] })).toBe(false);
    expect(hasDigestChanged({ value: "old" }, { value: undefined })).toBe(true);
    expect(hasDigestChanged({ values: ["a", "b"] }, { values: ["b", "a"] })).toBe(true);
    expect(hasDigestChanged({ value: { a: 1, b: 2 } }, { value: { b: 2, a: 1 } })).toBe(true);
  });

  it("reconciles in stored order before inserting in pending order", async () => {
    const { db, insert, patch, deleteRow } = writer();
    const unchanged = row("same");
    const changed = row("changed", "changed", 1);
    const obsolete = row("obsolete");
    const duplicate = row("same", "duplicate");
    const pending = new Map(
      ["same", "changed", "new-b", "new-a"].map((topic) => [topic, fields(topic)]),
    );

    await reconcileSearchDigestRows(
      db,
      "skillTopicSearchDigest",
      [unchanged, changed, obsolete, duplicate],
      pending,
      (entry) => entry.topic,
    );

    expect(patch.mock.calls).toEqual([[changed._id, fields("changed")]]);
    expect(deleteRow.mock.calls).toEqual([[obsolete._id], [duplicate._id]]);
    expect(insert.mock.calls).toEqual([
      ["skillTopicSearchDigest", fields("new-b")],
      ["skillTopicSearchDigest", fields("new-a")],
    ]);
    const order = [
      ...patch.mock.invocationCallOrder.map((at) => ({ at, operation: "patch" })),
      ...deleteRow.mock.invocationCallOrder.map((at) => ({ at, operation: "delete" })),
      ...insert.mock.invocationCallOrder.map((at) => ({ at, operation: "insert" })),
    ];
    expect(order.sort((a, b) => a.at - b.at).map((entry) => entry.operation)).toEqual([
      "patch",
      "delete",
      "delete",
      "insert",
      "insert",
    ]);
    expect([...pending.keys()]).toEqual(["new-b", "new-a"]);
  });

  it("does not consume a failed patch or continue to later rows", async () => {
    const { db, insert, patch, deleteRow } = writer();
    patch.mockRejectedValueOnce(new Error("patch failed"));
    const pending = new Map(["same", "changed", "new"].map((topic) => [topic, fields(topic)]));

    await expect(
      reconcileSearchDigestRows(
        db,
        "skillTopicSearchDigest",
        [row("same"), row("changed", "changed", 1), row("obsolete")],
        pending,
        (entry) => entry.topic,
      ),
    ).rejects.toThrow("patch failed");

    expect([...pending.keys()]).toEqual(["changed", "new"]);
    expect(deleteRow).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});
