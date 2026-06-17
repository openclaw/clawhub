import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const skill = readFileSync(
  join(process.cwd(), ".agents/skills/clawhub-content-rights-correspondence/SKILL.md"),
  "utf8",
);

const section = (heading: string) => {
  const start = skill.indexOf(`## ${heading}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = skill.indexOf("\n## ", start + 1);
  return skill.slice(start, next === -1 ? undefined : next);
};

describe("ClawHub content rights correspondence skill", () => {
  it("uses direct admin CLI commands instead of the removed helper script", () => {
    expect(skill).toMatch(/Do not use helper\s+scripts/);
    expect(skill).not.toContain("send-correspondence");
    expect(skill).not.toContain("scripts/");
    expect(skill).toContain("bun run admin -- email send");
  });

  it("keeps the explicit send-signoff guard in the requester status update send command", () => {
    const replies = section("Requester Status Updates");
    expect(replies).toContain("--send");
    expect(replies).toContain("--confirm-user-request");
    expect(replies).toContain("--confirm-user-signoff");
  });

  it("documents preserving outbound correspondence through the admin CLI", () => {
    expect(skill).toContain("content-rights record-correspondence");
    expect(skill).toContain("--provider-message-id");
    expect(skill).toContain("--attachment");
  });
});
