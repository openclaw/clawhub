/* @vitest-environment node */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureOpenClawDocsRepo,
  escapeMdxComponentsOutsideFences,
  fenceAwareDedentComponentChildren,
  patchDocsTableCss,
  planDocsStage,
  resolveOpenClawDocsRepo,
  stripMdxImportsOutsideFences,
} from "./docs-builder.mjs";

describe("docs-builder", () => {
  it("stages ClawHub docs in the shape expected by openclaw/docs", () => {
    const entries = planDocsStage([
      "README.md",
      "assets/clawd-logo.png",
      "clawhub.md",
      "docs.json",
      "quickstart.md",
      "specs/private.md",
    ]);

    expect(entries).toEqual([
      {
        injectSourcePath: null,
        sourceRel: "assets/clawd-logo.png",
        stageRel: "assets/clawd-logo.png",
      },
      { injectSourcePath: null, sourceRel: "docs.json", stageRel: "docs.json" },
      {
        injectSourcePath: "clawhub/index.md",
        sourceRel: "clawhub.md",
        stageRel: "index.md",
      },
      {
        injectSourcePath: "clawhub/quickstart.md",
        sourceRel: "quickstart.md",
        stageRel: "quickstart.md",
      },
    ]);
  });

  it("resolves an explicit openclaw/docs checkout", () => {
    const docsRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawhub-openclaw-docs-"));
    fs.mkdirSync(path.join(docsRepoDir, "scripts", "docs-site"), { recursive: true });
    fs.writeFileSync(
      path.join(docsRepoDir, "package.json"),
      `${JSON.stringify({ name: "openclaw-docs-site" })}\n`,
      "utf8",
    );
    fs.writeFileSync(path.join(docsRepoDir, "scripts", "docs-site", "build.mjs"), "", "utf8");

    expect(
      resolveOpenClawDocsRepo({
        cwd: "/repo/clawhub",
        env: { OPENCLAW_DOCS_REPO_DIR: docsRepoDir },
        homedir: "/home/me",
      }),
    ).toBe(docsRepoDir);
  });

  it("resolves the installed openclaw-docs-site package when no checkout is explicit", () => {
    const docsRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawhub-openclaw-docs-"));
    fs.mkdirSync(path.join(docsRepoDir, "scripts", "docs-site"), { recursive: true });
    fs.writeFileSync(
      path.join(docsRepoDir, "package.json"),
      `${JSON.stringify({ name: "openclaw-docs-site" })}\n`,
      "utf8",
    );
    fs.writeFileSync(path.join(docsRepoDir, "scripts", "docs-site", "build.mjs"), "", "utf8");

    expect(
      resolveOpenClawDocsRepo({
        cwd: "/repo/clawhub",
        env: {},
        homedir: "/home/me",
        resolvePackageRoot: () => docsRepoDir,
      }),
    ).toBe(docsRepoDir);
  });

  it("fails when neither an explicit checkout nor installed package is available", () => {
    expect(() =>
      resolveOpenClawDocsRepo({
        cwd: "/repo/clawhub",
        env: {},
        exists: () => false,
        homedir: "/home/me",
        resolvePackageRoot: () => "",
      }),
    ).toThrow(/OPENCLAW_DOCS_REPO_DIR/);
  });

  it("rejects invalid openclaw/docs roots instead of cloning one", () => {
    const invalidDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawhub-not-docs-"));
    fs.writeFileSync(path.join(invalidDir, "package.json"), "{}\n", "utf8");

    expect(() => ensureOpenClawDocsRepo(invalidDir)).toThrow(/not an openclaw\/docs checkout/);
  });

  it("strips MDX imports without stripping imports from fenced examples", () => {
    const markdown = [
      'import Card from "./Card.mdx";',
      "",
      "```typescript",
      'import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";',
      "```",
      "",
      "~~~ts",
      'import { Type } from "typebox";',
      "~~~",
    ].join("\n");

    expect(stripMdxImportsOutsideFences(markdown)).toBe(
      [
        "",
        "",
        "```typescript",
        'import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";',
        "```",
        "",
        "~~~ts",
        'import { Type } from "typebox";',
        "~~~",
      ].join("\n"),
    );
  });

  it("preserves code indentation relative to nested component fences", () => {
    const marker = "OPENCLAW_DOCS_MARKER";
    const markdown = [
      `${marker}:blockOpen:`,
      `${marker}:stepOpen:`,
      `${marker}:blockOpen:`,
      "```json",
      "{",
      '  "name": "unindented-fence"',
      "}",
      "```",
      "    ```json",
      "    {",
      '      "name": "indented-fence"',
      "    }",
      "    ```",
      `${marker}:blockClose:`,
      `${marker}:stepClose:`,
      `${marker}:blockClose:`,
    ].join("\n");

    expect(fenceAwareDedentComponentChildren(markdown)).toContain(
      ["```json", "{", '  "name": "unindented-fence"', "}", "```"].join("\n"),
    );
    expect(fenceAwareDedentComponentChildren(markdown)).toContain(
      ["```json", "{", '  "name": "indented-fence"', "}", "```"].join("\n"),
    );
  });

  it("recognizes valid indented closing fences before nested components", () => {
    const marker = "OPENCLAW_DOCS_MARKER";
    const markdown = [
      `${marker}:blockOpen:`,
      "  ```js",
      "  const x = 1;",
      "   ```",
      `${marker}:calloutOpen:`,
      "    ```bash",
      "    echo nested",
      "    ```",
      `${marker}:calloutClose:`,
      `${marker}:blockClose:`,
    ].join("\n");

    const dedented = fenceAwareDedentComponentChildren(markdown);

    expect(dedented).toContain(["```js", "const x = 1;", " ```"].join("\n"));
    expect(dedented).toContain(["```bash", "echo nested", "```"].join("\n"));
  });

  it("escapes unsupported MDX components without escaping TypeScript generics", () => {
    const markdown = [
      "<Unsupported>",
      "    ```typescript",
      "    const store = openKeyedStore<MyRecord>();",
      "    ```",
      "</Unsupported>",
    ].join("\n");

    const escaped = escapeMdxComponentsOutsideFences(markdown);

    expect(escaped).toContain("&lt;Unsupported&gt;");
    expect(escaped).toContain("&lt;/Unsupported&gt;");
    expect(escaped).toContain("const store = openKeyedStore<MyRecord>();");
  });

  it("keeps tables readable and contains long headings on narrow screens", () => {
    const source = [
      "export function siteCss() {",
      "  return `",
      ".doc .oc-table{table-layout:fixed}",
      "`;",
      "}",
      "",
      "export function siteJs() {}",
    ].join("\n");

    const patched = patchDocsTableCss(source);

    expect(patched).toContain(
      ".doc .oc-table th,.doc .oc-table td,.doc .oc-table code{overflow-wrap:normal;word-break:normal}",
    );
    expect(patched).toContain(".doc .oc-table th,.doc .oc-table code{white-space:nowrap}");
    expect(patched).toContain(
      "@media(max-width:820px){.doc .oc-table{min-width:560px;table-layout:auto}.doc h2,.doc h3,.doc h4{overflow-wrap:anywhere;word-break:normal}}",
    );
  });
});
