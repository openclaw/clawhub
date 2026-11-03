import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PackageFamilySchema, PackagePublishFamilySchema } from "./packages";
import { ApiRoutes } from "./routes";
import { validateTemplatePackageContents } from "./templatePackage";
import { TEMPLATE_MANIFEST_VALIDATION_CODES } from "./templates";

describe("Template naming contracts", () => {
  it("accepts only the Template family, without the unused legacy alias", () => {
    for (const schema of [PackageFamilySchema, PackagePublishFamilySchema]) {
      expect(schema.assert("template")).toBe("template");
      expect(() => schema.assert("claw")).toThrow();
    }
    expect(ApiRoutes.catalogTemplatesFeed).toBe("/api/v1/feeds/templates");
    expect(Object.values(TEMPLATE_MANIFEST_VALIDATION_CODES)).toEqual(
      expect.arrayContaining(["template_v1_invalid_manifest_shape"]),
    );
    expect(
      Object.values(TEMPLATE_MANIFEST_VALIDATION_CODES).every((code) =>
        code.startsWith("template_v1_"),
      ),
    ).toBe(true);
  });

  it("requires openclaw.template while retaining the exact CLAW.md envelope", () => {
    const base = {
      packageName: "@acme/triage",
      version: "1.0.0",
      files: [
        {
          path: "CLAW.md",
          text: "---\nschemaVersion: 1\nagent: { id: triage }\n---\nBe precise.\n",
        },
      ],
    };
    expect(
      validateTemplatePackageContents({
        ...base,
        packageJson: {
          name: base.packageName,
          version: base.version,
          openclaw: { template: "CLAW.md" },
        },
      }),
    ).toMatchObject({
      ok: true,
      value: { manifestPath: "CLAW.md", hasTemplateMarkdownBody: true },
    });
    expect(
      validateTemplatePackageContents({
        ...base,
        packageJson: {
          name: base.packageName,
          version: base.version,
          openclaw: { claw: "CLAW.md" },
        },
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "invalid_template_manifest_path", path: "package.json.openclaw.template" }],
    });
  });

  it("keeps the CLI's standalone manifest validators identical to their owning schema source", () => {
    for (const file of ["templates.ts", "templatePackage.ts"]) {
      expect(readFileSync(`packages/clawhub/src/schema/${file}`, "utf8")).toBe(
        readFileSync(`packages/schema/src/${file}`, "utf8"),
      );
    }
  });

  it("documents the current family and feed discriminator across public references", () => {
    const feedSpec = readFileSync("specs/experimental-template-feed.md", "utf8");
    const cliDocs = readFileSync("docs/cli.md", "utf8");
    const apiDocs = readFileSync("docs/http-api.md", "utf8");
    expect(feedSpec).toContain("- Entry type: `template` only");
    expect(feedSpec).not.toContain("- Entry type: `claw` only");
    expect(cliDocs).toContain("--family skill|code-plugin|bundle-plugin|template");
    expect(cliDocs).not.toContain("including `claw`");
    expect(apiDocs).toContain(
      "`family` (optional): `skill`, `code-plugin`, `bundle-plugin`, or `template`",
    );
    expect(apiDocs).toContain("`GET /api/v1/feeds/templates` and `GET /v1/feeds/templates`");
  });
});
