import { describe, expect, it } from "vitest";
import { parseConvexJson, parseConvexJsonMatching } from "./convexOutput";

describe("Convex CLI output parsing", () => {
	it("parses a JSON object with nested braces and trailing CLI text", () => {
		expect(
			parseConvexJson(
				[
					"Running function...",
					'{ "page": [{ "text": "brace } inside string", "items": [1, 2] }], "isDone": true }',
					"Function ran successfully.",
				].join("\n"),
			),
		).toEqual({
			page: [{ text: "brace } inside string", items: [1, 2] }],
			isDone: true,
		});
	});

	it("skips incomplete JSON-looking prefixes", () => {
		expect(parseConvexJson("partial { nope\n[1, 2, 3]\n")).toEqual([1, 2, 3]);
	});

	it("can require the expected response envelope", () => {
		const output = [
			'{"artifactSha256":"nested-artifact"}',
			'{"continueCursor":"cursor","exportMode":"public","isDone":false,"page":[]}',
		].join("\n");

		expect(
			parseConvexJsonMatching(
				output,
				(value): value is { continueCursor: string } =>
					typeof value === "object" &&
					value !== null &&
					"continueCursor" in value &&
					"page" in value,
			),
		).toEqual({
			continueCursor: "cursor",
			exportMode: "public",
			isDone: false,
			page: [],
		});
	});
});
