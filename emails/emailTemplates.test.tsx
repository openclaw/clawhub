/* @vitest-environment node */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, toPlainText } from "@react-email/render";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

type PreviewableTemplate = {
  default: ((props: Record<string, unknown>) => ReactElement) & {
    PreviewProps?: Record<string, unknown>;
  };
};

const templates = [
  ["account suspended", "./account-suspended"],
  ["account reinstated", "./account-reinstated"],
  ["blocked version", "./blocked-version"],
  ["plugin inspector findings", "./plugin-inspector-findings"],
  ["admin one-off", "./admin-one-off"],
] as const;

describe("React Email templates", () => {
  it("adds a local preview command on the expected port", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

    expect(packageJson.scripts["email:dev"]).toBe("email dev --dir emails --port 8765");
  });

  it.each(templates)("renders %s from PreviewProps", async (_name, modulePath) => {
    const template = (await import(modulePath)) as PreviewableTemplate;

    expect(typeof template.default).toBe("function");
    expect(template.default.PreviewProps).toBeDefined();

    const html = await render(template.default(template.default.PreviewProps ?? {}));
    const text = toPlainText(html);

    expect(html).toContain("ClawHub");
    expect(html).toContain("OpenClaw");
    expect(html).toContain("https://docs.clawhub.ai");
    expect(text).toContain("ClawHub");
  });
});
