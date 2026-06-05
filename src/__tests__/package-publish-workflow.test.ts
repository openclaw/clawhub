import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("package publish workflow", () => {
  it("runs plugin-inspector before publishing and uploads inspector artifacts", () => {
    const workflow = readFileSync(resolve(".github/workflows/package-publish.yml"), "utf8");

    const inspectorIndex = workflow.indexOf("Run plugin inspector");
    const publishIndex = workflow.indexOf("Run package publish");
    const checkoutPublishSourceIndex = workflow.indexOf(
      "Checkout publish source for plugin inspector",
    );

    expect(inspectorIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(-1);
    expect(checkoutPublishSourceIndex).toBeGreaterThan(-1);
    expect(checkoutPublishSourceIndex).toBeLessThan(inspectorIndex);
    expect(inspectorIndex).toBeLessThan(publishIndex);
    expect(workflow).toContain("inspect_checkout_repository");
    expect(workflow).toContain("clawhub-publish-source");
    expect(workflow).toContain("INSPECT_LOCAL_ROOT");
    expect(workflow).toContain("source_ref_differs_from_checkout");
    expect(workflow).toContain("resolve_github_url_ref_and_path");
    expect(workflow).toContain("quote(ref, safe='')");
    expect(workflow).toContain("error.code in (404, 422)");
    expect(workflow).toContain('config_path = root / ".plugin-inspector.json"');
    expect(workflow).toContain("generated_config_path.write_text(str(config_path)");
    expect(workflow).toContain("cleanup_generated_inspector_config");
    expect(workflow).toContain('rm -f "$generated_config"');
    expect(workflow).toContain('re.sub(r"[^a-z0-9]+", "-", base)');
    expect(workflow).toContain("@openclaw/plugin-inspector");
    expect(workflow).toContain("ci --no-openclaw");
    expect(workflow).toContain("plugin-inspector-report");
    expect(workflow).toContain("actions/upload-artifact");
  });
});
