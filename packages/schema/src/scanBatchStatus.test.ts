import { describe, expect, it } from "vitest";
import { ApiV1SkillScanBatchStatusResponseSchema } from "./schemas.js";

const legacy = {
  ok: true,
  total: 2,
  queued: 1,
  running: 0,
  succeeded: 1,
  failed: 0,
  missing: 0,
  terminal: 1,
  done: false,
  failedJobIds: [],
};

describe("bulk skill status assignment compatibility", () => {
  it("accepts an older server without pretending it returned queued identities", () => {
    expect(ApiV1SkillScanBatchStatusResponseSchema.assert(legacy)).not.toHaveProperty(
      "queuedJobIds",
    );
  });

  it("preserves queued identities for local assignment and rejects malformed identities", () => {
    expect(
      ApiV1SkillScanBatchStatusResponseSchema.assert({ ...legacy, queuedJobIds: ["queued-job"] }),
    ).toMatchObject({ queuedJobIds: ["queued-job"] });
    expect(() =>
      ApiV1SkillScanBatchStatusResponseSchema.assert({ ...legacy, queuedJobIds: [1] }),
    ).toThrow();
  });
});
