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
    }

    // categories and topics are slug lists, where surrounding whitespace is noise.
    for (const name of ["categories", "topics"] as const) {
      expect(workflow).toContain(
        `          ${name} = os.environ["INPUT_${name.toUpperCase()}"].strip()`,
      );
      expect(workflow).toContain(
        `              if ${name}:\n                  command += ["--${name}", ${name}]`,
      );
    }
  });

  it("forwards changelog Markdown exactly as the caller wrote it", () => {
    const workflow = readFileSync(resolve(".github/workflows/skill-publish.yml"), "utf8");

    // `skill publish --changelog` stores its argument untouched, and in Markdown both
    // leading indentation and a trailing double space carry meaning, so the workflow
    // must not trim the value on its way to that same CLI.
    expect(workflow).toContain('          changelog = os.environ["INPUT_CHANGELOG"]\n');
    expect(workflow).not.toContain('os.environ["INPUT_CHANGELOG"].strip()');
    // Only the decision to forward looks past whitespace: a blank input stays a no-op.
    expect(workflow).toContain(
      '              if changelog.strip():\n                  command += ["--changelog", changelog]',
    );
  });

  it("can clear catalog metadata the CLI already treats as an explicit empty value", () => {
    const workflow = readFileSync(resolve(".github/workflows/skill-publish.yml"), "utf8");
    const parsed = parseYaml(workflow) as {
      on: {
        workflow_call: {
          inputs: Record<string, { type: string; required: boolean; default: boolean }>;
        };
      };
    };
    const inputs = parsed.on.workflow_call.inputs;

    for (const name of ["categories", "topics"] as const) {
      const clearName = `clear_${name}` as const;

      // Omitting the input must stay the no-op it is today, so the clear is its own signal.
      expect(inputs[clearName]).toMatchObject({
        type: "boolean",
        required: false,
        default: false,
      });
      expect(workflow).toContain(
        `          INPUT_CLEAR_${name.toUpperCase()}: \${{ inputs.${clearName} }}`,
      );
      expect(workflow).toContain(
        `          ${clearName} = os.environ["INPUT_CLEAR_${name.toUpperCase()}"] == "true"`,
      );
      // A non-empty value wins nothing silently - the two are mutually exclusive.
      expect(workflow).toContain(`              (${name}, ${clearName}, "${name}"),`);
      expect(workflow).toContain(
        `              elif ${clearName}:\n                  command += ["--${name}", ""]`,
      );
    }

    expect(workflow).toContain("if value and clearing:\n                  raise SystemExit(");
    // changelog has no clear counterpart: the CLI reads an omitted --changelog as "".
    expect(inputs.clear_changelog).toBeUndefined();
  });

  it("logs the resolved command without routing it through a shell", () => {
    const workflow = readFileSync(resolve(".github/workflows/skill-publish.yml"), "utf8");

    expect(workflow).toContain(
      "print(f\"Resolved publish command: {' '.join(quote_for_log(part) for part in command)}\", flush=True)",
    );
    expect(workflow).toContain("completed = subprocess.run(command, cwd=workspace");
    expect(workflow).not.toContain("shell=True");
  });

  it("keeps a metadata value carrying CR or LF from opening a second log line", () => {
    const workflow = readFileSync(resolve(".github/workflows/skill-publish.yml"), "utf8");

    // shlex.quote is shell quoting, not output escaping: it wraps a value in single quotes
    // and leaves an embedded line break intact, so a changelog, categories or topics value
    // holding "\n::error::" would reach the runner as its own ::workflow-command line.
    expect(workflow).toContain(
      [
        "              quoted = shlex.quote(part)",
        "              return quoted if quoted.isprintable() else json.dumps(part)",
      ].join("\n"),
    );
    expect(workflow).not.toContain("' '.join(shlex.quote(part) for part in command)");
  });

  it("preserves publish output when a target fails", () => {
    const workflow = readFileSync(resolve(".github/workflows/skill-publish.yml"), "utf8");

    expect(workflow).toContain("id: capture\n        if: ${{ always() }}");
    expect(workflow).toContain("if not output_path.is_file():");
    expect(workflow).toContain("uses: actions/upload-artifact@v7\n        if: ${{ always() }}");
    expect(workflow).toContain("if-no-files-found: ignore");
  });
});
