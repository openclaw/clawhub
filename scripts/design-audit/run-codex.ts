import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseFindings } from "./report";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function run(command: string, args: string[], input: string, logPath: string) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", async (code) => {
      await writeFile(logPath, Buffer.concat(chunks));
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(-2_000)}`));
    });
    child.stdin.end(input);
  });
}

async function main() {
  const deterministicPath = argument("--deterministic");
  const browserPath = argument("--browser");
  const outputPath = argument("--output");
  const eventsPath = argument("--events");
  const screenshotDir = argument("--screenshots");
  const designSystemDirectory = argument("--design-system");
  if (
    !deterministicPath ||
    !browserPath ||
    !outputPath ||
    !eventsPath ||
    !screenshotDir ||
    !designSystemDirectory
  ) {
    throw new Error(
      "usage: run-codex.ts --deterministic <path> --browser <path> --screenshots <dir> --design-system <dir> --output <path> --events <path>",
    );
  }

  await mkdir(dirname(outputPath), { recursive: true });
  const screenshots = (await readdir(screenshotDir))
    .filter((path) => path.endsWith(".png"))
    .sort()
    .map((path) => resolve(screenshotDir, path));
  const deterministic = await readFile(deterministicPath, "utf8");
  const browser = await readFile(browserPath, "utf8");
  const prompt = `You are running the scheduled ClawHub design audit.

Read and follow:
- ${designSystemDirectory}/openclaw-design-audit/SKILL.md and every referenced file
- ${designSystemDirectory}/openclaw-design-system/references/tokens.md
- ${designSystemDirectory}/openclaw-design-system/references/consumer-adapters.md

Audit the current repository. Deterministic checks ran first and produced:
${deterministic}

Real-browser checks and screenshot paths:
${browser}

Inspect the attached screenshots for desktop/mobile and light/dark parity. Verify every finding against source. Never invent a source file or line. Cover semantic tokens, shared primitive usage, deprecated aliases, accessibility, copy clarity, responsive behavior, and recurring pattern candidates.

You may apply only narrow, high-confidence fixes allowed by fix-policy.md. Edit only existing frontend files under src/ with .ts, .tsx, or .css extensions. Do not edit backend behavior, dependencies, workflows, configuration, generated files, reports, or design-audit scripts. Do not add files. Do not make broad redesign, navigation, hierarchy, or information-architecture changes. Keep subjective ideas as informational findings without source edits.

Return every confirmed error. Return warnings before informational suggestions. Include precise repository-relative source locations and canonical design-system references. Report the exact files you changed.`;
  const args = [
    "exec",
    "--cd",
    process.cwd(),
    "--model",
    process.env.DESIGN_AUDIT_CODEX_MODEL ?? "gpt-5.5",
    "--sandbox",
    "workspace-write",
    "--ignore-user-config",
    "-c",
    "approval_policy=never",
    "-c",
    `model_reasoning_effort=${process.env.DESIGN_AUDIT_REASONING_EFFORT ?? "high"}`,
    "-c",
    `service_tier=${process.env.DESIGN_AUDIT_SERVICE_TIER ?? "fast"}`,
    "-c",
    'shell_environment_policy.inherit="core"',
    "-c",
    "shell_environment_policy.ignore_default_excludes=false",
    "--output-schema",
    join(process.cwd(), "scripts/design-audit/codex-output.schema.json"),
    "--output-last-message",
    outputPath,
    "--ephemeral",
    "--json",
  ];
  for (const screenshot of screenshots) args.push("--image", screenshot);
  args.push("-");

  await run("codex", args, prompt, eventsPath);
  const parsed = JSON.parse(await readFile(outputPath, "utf8"));
  parseFindings(parsed);
  console.log(`Codex returned ${parsed.findings.length} findings`);
}

if (import.meta.main) {
  await main();
}
