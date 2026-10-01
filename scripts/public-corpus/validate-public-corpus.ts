#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { DEFAULT_PUBLIC_CORPUS_FIXTURE, validateCorpusJsonl } from "./validate";

async function main() {
  const fixture = process.argv[2] ?? DEFAULT_PUBLIC_CORPUS_FIXTURE;
  const text = await readFile(fixture, "utf8");
  const result = validateCorpusJsonl(text);

  if (result.ok) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          fixture,
          rowCount: result.rowCount,
          skillCount: result.skillCount,
          pluginCount: result.pluginCount,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.error(
    JSON.stringify(
      {
        ok: false,
        fixture,
        rowCount: result.rowCount,
        skillCount: result.skillCount,
        pluginCount: result.pluginCount,
        findings: result.findings.slice(0, 100),
        findingCount: result.findings.length,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
