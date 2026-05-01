import { describe, expect, it } from "vitest";
import { reserveExportInputs } from "./exportLimit";

describe("security dataset export limits", () => {
  it("reserves rows synchronously so concurrent shards cannot exceed the global limit", () => {
    const state = { sourceArtifacts: 0 };

    expect(reserveExportInputs(["a", "b", "c"], state, 5)).toEqual(["a", "b", "c"]);
    expect(reserveExportInputs(["d", "e", "f"], state, 5)).toEqual(["d", "e"]);
    expect(reserveExportInputs(["g"], state, 5)).toEqual([]);
    expect(state.sourceArtifacts).toBe(5);
  });

  it("counts all rows when no limit is set", () => {
    const state = { sourceArtifacts: 2 };

    expect(reserveExportInputs(["a", "b"], state, null)).toEqual(["a", "b"]);
    expect(state.sourceArtifacts).toBe(4);
  });
});
