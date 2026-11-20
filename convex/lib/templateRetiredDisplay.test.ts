import { describe, expect, it } from "vitest";
import { retiredTemplateDisplayInput } from "./templateRetiredDisplay";

const path = "CLAW.md";
const raw = (fields: Record<string, unknown>) =>
  [
    "---",
    JSON.stringify({ schemaVersion: 1, agent: { id: "old" }, ...fields }),
    "---",
    "Original published instructions",
  ].join("\n");
describe("display-only recognition of retired v1 declarations", () => {
  it("rechecks package refs and old schedules as current declarations without altering the original", () => {
    const ref = { ref: "@example/guide", version: "1.0.0" };
    const job = {
      id: "daily",
      schedule: { cron: "0 9 * * *", timezone: "UTC" },
      message: "Daily reminder",
      session: "isolated",
    };
    const original = raw({
      packages: [{ kind: "skill", source: "clawhub", ...ref }],
      cronJobs: [job],
    });
    const input = retiredTemplateDisplayInput(original, path, []);
    expect(input?.text).toBe(raw({ skills: [ref], automations: [job] }));
    expect(original).toContain('"packages"');
  });
  it("recognizes only an existing conventional profile pointer", () => {
    const original = raw({ metadata: { "openclaw.config": "profiles/openclaw.yml" } });
    expect(retiredTemplateDisplayInput(original, path, [])).toBeNull();
    expect(
      retiredTemplateDisplayInput(original, path, ["profiles/openclaw.yml"])?.profiles.has(
        "profiles/openclaw.yml",
      ),
    ).toBe(true);
  });
  it.each([
    { schemaVersion: 2, packages: [] },
    { packages: [{ kind: "skill", source: "other" }] },
    { cronJobs: [], automations: [] },
    { profiles: ["unknown"] },
  ])("does not guess unsupported grammar: %j", (fields) => {
    expect(retiredTemplateDisplayInput(raw(fields), path, [])).toBeNull();
  });
});
