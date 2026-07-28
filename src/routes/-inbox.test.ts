import { describe, expect, it } from "vitest";
import { formatReleaseCount } from "./inbox";

describe("following inbox presentation", () => {
  it("describes singleton and coalesced release groups", () => {
    expect(formatReleaseCount(1)).toBe("1 release");
    expect(formatReleaseCount(50)).toBe("50 releases");
  });
});
