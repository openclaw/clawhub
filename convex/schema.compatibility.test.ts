import { describe, expect, it } from "vitest";
import schema from "./schema";

describe("production schema compatibility", () => {
  it("retains the retired VT index without requiring a destructive deployment", () => {
    const index = schema.tables.skillVersions[" indexes"]().find(
      (candidate) => candidate.indexDescriptor === "by_active_vt_status_created",
    );

    expect(index?.fields).toEqual(["softDeletedAt", "vtAnalysis.status", "createdAt"]);
  });
});
