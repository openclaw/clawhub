/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { parseArk } from "./ark";
import { ApiV1SearchResponseSchema, ClawdisSkillMetadataSchema } from "./schemas";

describe("packages/clawhub skill metadata schema", () => {
  it("preserves optional env var declarations", () => {
    const parsed = parseArk(
      ClawdisSkillMetadataSchema,
      {
        envVars: [
          { name: "TODOIST_API_KEY", required: true, description: "API token" },
          { name: "TODOIST_PROJECT_ID", required: false, description: "Default project" },
        ],
      },
      "Skill metadata",
    );

    expect(parsed.envVars?.[1]).toEqual({
      name: "TODOIST_PROJECT_ID",
      required: false,
      description: "Default project",
    });
  });

  it("parses v1 search owner metadata", () => {
    const parsed = parseArk(
      ApiV1SearchResponseSchema,
      {
        results: [
          {
            slug: "weather",
            displayName: "Weather",
            version: "1.0.0",
            score: 4.553,
            ownerHandle: "steipete",
            owner: {
              handle: "steipete",
              displayName: "Peter Steinberger",
              image: null,
            },
          },
        ],
      },
      "V1 search",
    );

    expect(parsed.results[0]?.ownerHandle).toBe("steipete");
    expect(parsed.results[0]?.owner?.handle).toBe("steipete");
  });
});
