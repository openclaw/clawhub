import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import ts from "typescript";

const root = process.cwd();
const convexDir = join(root, "convex");
const FUNCTION_FACTORIES = new Set([
  "query",
  "mutation",
  "action",
  "internalQuery",
  "internalMutation",
  "internalAction",
]);

function walkTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith("_generated")) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTsFiles(fullPath));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    files.push(fullPath);
  }
  return files;
}

function getExpectedIdentifiers() {
  const identifiers = new Set<string>();
  for (const filePath of walkTsFiles(convexDir)) {
    const source = readFileSync(filePath, "utf8");
    const modulePath = relative(convexDir, filePath).replace(/\\/g, "/").replace(/\.ts$/, ".js");
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
    ts.forEachChild(sourceFile, (node) => {
      if (!ts.isVariableStatement(node)) return;
      const isExported = node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (!isExported) return;

      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        if (!ts.isCallExpression(declaration.initializer)) continue;
        const callee = declaration.initializer.expression;
        if (!ts.isIdentifier(callee) || !FUNCTION_FACTORIES.has(callee.text)) continue;
        identifiers.add(`${modulePath}:${declaration.name.text}`);
      }
    });
  }
  return identifiers;
}

function getRemoteIdentifiers(cliArgs: string[]) {
  const tempDir = mkdtempSync(join(tmpdir(), "clawhub-function-spec-"));
  const result = spawnSync("bunx", ["convex", "function-spec", "--file", ...cliArgs], {
    cwd: tempDir,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }

  const fileName = readdirSync(tempDir)
    .filter((entry) => entry.startsWith("function_spec_") && entry.endsWith(".json"))
    .sort()
    .at(-1);
  if (!fileName) {
    process.stderr.write(result.stderr || result.stdout || "Missing function spec output\n");
    process.exit(1);
  }

  const parsed = JSON.parse(readFileSync(join(tempDir, fileName), "utf8")) as {
    functions?: Array<{ identifier?: string }>;
  };
  return new Set(
    (parsed.functions ?? []).flatMap((entry) => (entry.identifier ? [entry.identifier] : [])),
  );
}

const cliArgs = process.argv.slice(2);
const expected = getExpectedIdentifiers();
const remote = getRemoteIdentifiers(cliArgs);

const missing = Array.from(expected)
  .filter((identifier) => !remote.has(identifier))
  .sort();

if (missing.length > 0) {
  console.error("Convex contract mismatch. Missing remote identifiers:");
  for (const identifier of missing) {
    console.error(`- ${identifier}`);
  }
  process.exit(1);
}

console.log(`Convex contract ok: ${expected.size} identifiers matched remote deployment.`);
