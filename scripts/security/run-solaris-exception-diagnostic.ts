import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { main as runVerifiedSolarisDiagnostic } from "./solaris-bundled-diagnostic";

export function selectSolarisExceptionCase(env: NodeJS.ProcessEnv, args: string[]) {
  if (
    args.length ||
    env.GITHUB_WORKFLOW_REF !==
      "openclaw/clawhub/.github/workflows/solaris-exception-diagnostic.yml@refs/heads/main"
  )
    throw new Error("Fixed exception workflow required");
  if (env.GITHUB_JOB === "fleet-root") return "fleet-error" as const;
  if (env.GITHUB_JOB === "all-roots") return "all-error" as const;
  throw new Error("Fixed exception job required");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    await runVerifiedSolarisDiagnostic(args, selectSolarisExceptionCase(process.env, args));
  } catch {
    process.stderr.write("Fixed exception diagnostic admission or cleanup failed\n");
    process.exitCode = 1;
  }
}
