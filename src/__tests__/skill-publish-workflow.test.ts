import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

describe("skill publish workflow", () => {
  it("publishes one skill at a time without recreating the sync command", () => {
    const workflow = readFileSync(resolve(".github/workflows/skill-publish.yml"), "utf8");

    expect(() => parseYaml(workflow)).not.toThrow();
    expect(workflow).toContain("skill publish");
    expect(workflow).toContain("INPUT_SKILL_PATH");
    expect(workflow).toContain("INPUT_ROOT");
    expect(workflow).toContain("--dry-run");
    expect(workflow).toContain("--json");
    expect(workflow).toContain("--source-repo");
    expect(workflow).toContain("--source-commit");
    expect(workflow).toContain("alreadySynced");
    expect(workflow).toContain("wouldPublish");
    expect(workflow).toMatch(
      /for child in root\.iterdir\(\):\s+resolved_child = resolve_inside_workspace\(child\)\s+if is_skill_folder\(resolved_child\):\s+discovered\.append\(resolved_child\)/,
    );
    expect(workflow).not.toMatch(/\bsync\b/);
    expect(workflow).not.toContain("--bump");
  });

  it("forwards optional catalog metadata through the argument list", () => {
    const workflow = readFileSync(resolve(".github/workflows/skill-publish.yml"), "utf8");
    const parsed = parseYaml(workflow) as {
      on: {
        workflow_call: {
          inputs: Record<string, { type: string; required: boolean; default: string }>;
        };
      };
    };
    const inputs = parsed.on.workflow_call.inputs;

    for (const name of ["changelog", "categories", "topics"] as const) {
      const envName = `INPUT_${name.toUpperCase()}`;

      expect(inputs[name]).toMatchObject({ type: "string", required: false, default: "" });
      expect(workflow).toContain(`          ${envName}: \${{ inputs.${name} }}`);
      expect(workflow).toContain(`          ${name} = os.environ["${envName}"].strip()`);
      expect(workflow).toContain(
        `              if ${name}:\n                  command += ["--${name}", ${name}]`,
      );
    }
  });

  it("logs the resolved command without routing it through a shell", () => {
    const workflow = readFileSync(resolve(".github/workflows/skill-publish.yml"), "utf8");

    expect(workflow).toContain(
      "print(f\"Resolved publish command: {' '.join(shlex.quote(part) for part in command)}\", flush=True)",
    );
    expect(workflow).toContain("completed = subprocess.run(command, cwd=workspace");
    expect(workflow).not.toContain("shell=True");
  });

  it("preserves publish output when a target fails", () => {
    const workflow = readFileSync(resolve(".github/workflows/skill-publish.yml"), "utf8");

    expect(workflow).toContain("id: capture\n        if: ${{ always() }}");
    expect(workflow).toContain("if not output_path.is_file():");
    expect(workflow).toContain("uses: actions/upload-artifact@v7\n        if: ${{ always() }}");
    expect(workflow).toContain("if-no-files-found: ignore");
  });
});
