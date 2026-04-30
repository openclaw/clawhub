import { describe, expect, it } from "vitest";
import { assertCreatedTimeWindow, clampCreatedBounds, parseCreatedTimestamp } from "./timeWindow";

describe("security dataset time windows", () => {
	it("parses millisecond timestamps and ISO dates", () => {
		expect(parseCreatedTimestamp("1777507200000", "--created-after")).toBe(1777507200000);
		expect(parseCreatedTimestamp("2026-04-30T00:00:00.000Z", "--created-before")).toBe(
			1777507200000,
		);
	});

	it("rejects inverted windows", () => {
		expect(() => assertCreatedTimeWindow({ createdAtGte: 20, createdAtLt: 10 })).toThrowError(
			"--created-after must be earlier than --created-before.",
		);
	});

	it("clamps source bounds to the requested window", () => {
		expect(
			clampCreatedBounds(
				{ sourceKind: "skill", minCreatedAt: 10, maxCreatedAt: 30 },
				{ createdAtGte: 15, createdAtLt: 25 },
			),
		).toEqual({ sourceKind: "skill", minCreatedAt: 15, maxCreatedAt: 24 });
	});

	it("returns empty bounds when the requested window does not overlap", () => {
		expect(
			clampCreatedBounds(
				{ sourceKind: "package", minCreatedAt: 10, maxCreatedAt: 30 },
				{ createdAtGte: 40, createdAtLt: null },
			),
		).toEqual({ sourceKind: "package", minCreatedAt: null, maxCreatedAt: null });
	});
});
