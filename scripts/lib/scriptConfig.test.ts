import { describe, expect, it } from "vitest";
import { parseEnv } from "./scriptConfig";

describe("script config", () => {
  it("parses env files without treating inline comments as values", () => {
    expect(
      parseEnv(`
        CONVEX_DEPLOYMENT=local:local-fixture-project # team: fixture, project: project
        SITE_URL=http://localhost:3000
        HASH_VALUE=abc#123
        QUOTED_HASH="value # kept"
      `),
    ).toEqual({
      CONVEX_DEPLOYMENT: "local:local-fixture-project",
      SITE_URL: "http://localhost:3000",
      HASH_VALUE: "abc#123",
      QUOTED_HASH: "value # kept",
    });
  });

  it("accepts CRLF and keeps the last duplicate while ignoring invalid assignments", () => {
    expect(parseEnv("KEY=first\r\nINVALID LINE\r\n1KEY=ignored\r\nKEY=last\r\nEMPTY=")).toEqual({
      KEY: "last",
      EMPTY: "",
    });
  });
});
