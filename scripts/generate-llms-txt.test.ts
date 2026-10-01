/* @vitest-environment node */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLlmsDocs, renderLlmsTxt, writeLlmsTxt } from "./generate-llms-txt";

const temporaryDirectories: string[] = [];

async function temporaryDocs() {
  const root = await mkdtemp(join(tmpdir(), "clawhub-llms-"));
  temporaryDirectories.push(root);
  const docsDir = join(root, "docs");
  await mkdir(docsDir);
  return docsDir;
}

async function writeDoc(docsDir: string, filename: string, content: string) {
  await writeFile(join(docsDir, filename), content, "utf8");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("llms.txt generation", () => {
  it("discovers publishable docs from frontmatter without maintaining a second index", async () => {
    const docsDir = await temporaryDocs();
    await writeDoc(docsDir, "zebra.md", `---\nsummary: "Zebra reference."\n---\n\n# Zebra\n`);
    await writeDoc(
      docsDir,
      "alpha.md",
      `---\nsummary: "Alpha reference."\ntitle: "Alpha Guide"\n---\n\n# Ignored fallback\n`,
    );
    await writeDoc(
      docsDir,
      "hidden.md",
      `---\nsummary: "Internal note."\nllms: false\n---\n\n# Hidden\n`,
    );
    await writeDoc(docsDir, "README.md", `---\nsummary: "Directory index."\n---\n\n# Docs\n`);

    await expect(readLlmsDocs(docsDir)).resolves.toEqual([
      {
        slug: "alpha",
        summary: "Alpha reference.",
        title: "Alpha Guide",
      },
      {
        slug: "zebra",
        summary: "Zebra reference.",
        title: "Zebra",
      },
    ]);
  });

  it("rejects a public doc without the metadata required by the machine index", async () => {
    const docsDir = await temporaryDocs();
    await writeDoc(docsDir, "broken.md", `---\nread_when:\n  - Testing\n---\n\n# Broken\n`);

    await expect(readLlmsDocs(docsDir)).rejects.toThrow(
      "docs/broken.md must define a non-empty summary",
    );
  });

  it("renders the current registry map from canonical routes and doc metadata", async () => {
    const output = await renderLlmsTxt();

    expect(output).toContain(
      "- [Skills](https://clawhub.ai/skills): Browse and search skill bundles centered on SKILL.md.",
    );
    expect(output).toContain(
      "- [Plugins and packages](https://clawhub.ai/plugins): Browse and search OpenClaw plugin package records.",
    );
    expect(output).toContain(
      "- [CLI](https://docs.openclaw.ai/clawhub/cli): CLI reference: commands, flags, config, and lockfile behavior.",
    );
    expect(output).toContain(
      "- [OpenAPI v1](https://clawhub.ai/api/v1/openapi.json): Machine-readable schema for the current ClawHub HTTP API.",
    );
    expect(output).not.toMatch(
      /clawhub sync|https:\/\/clawhub\.ai\/packages(?:\/|\b)|souls?|soul-format/i,
    );
    expect(output.split("").every((character) => character.charCodeAt(0) <= 127)).toBe(true);
    expect(output.endsWith("\n")).toBe(true);
  });

  it("writes the static asset once and leaves an identical file untouched", async () => {
    const root = await mkdtemp(join(tmpdir(), "clawhub-llms-output-"));
    temporaryDirectories.push(root);
    const outputFile = join(root, "llms.txt");

    await expect(writeLlmsTxt(outputFile)).resolves.toBe(true);
    await expect(readFile(outputFile, "utf8")).resolves.toBe(await renderLlmsTxt());
    await expect(writeLlmsTxt(outputFile)).resolves.toBe(false);
  });
});
