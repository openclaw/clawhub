const DEFAULT_CONVEX_URL = "http://127.0.0.1:3210";
const DEFAULT_CONVEX_SITE_URL = "http://127.0.0.1:3211";
export const DEFAULT_LOCAL_AUTH_CONVEX_DEPLOYMENT = "anonymous:anonymous-agent";
const DEFAULT_PLAYWRIGHT_ARGS = ["--project=chromium", "e2e/local-auth"];
const DEFAULT_PLAYWRIGHT_RETRIES = "1";

type RunnerEnv = Record<string, string | undefined>;

export type LocalAuthRunnerConfig = {
  convexDeployment: string | undefined;
  convexSiteUrl: string;
  convexUrl: string;
  playwrightArgs: string[];
};

function stripPackageManagerSeparator(args: string[]) {
  return args[0] === "--" ? args.slice(1) : args;
}

function withDefaultRetries(args: string[]) {
  if (args.some((arg) => arg === "--retries" || arg.startsWith("--retries="))) {
    return args;
  }
  return [`--retries=${DEFAULT_PLAYWRIGHT_RETRIES}`, ...args];
}

export function resolveLocalAuthDeployment(
  configuredDeployment: string | undefined,
  fallbackDeployment: string | null | undefined,
) {
  return configuredDeployment ?? fallbackDeployment ?? DEFAULT_LOCAL_AUTH_CONVEX_DEPLOYMENT;
}

export function resolveLocalAuthRunnerConfig(
  env: RunnerEnv = process.env,
  argv: string[] = process.argv.slice(2),
): LocalAuthRunnerConfig {
  const playwrightArgs = stripPackageManagerSeparator(argv);
  return {
    convexDeployment: env.PLAYWRIGHT_LOCAL_AUTH_CONVEX_DEPLOYMENT,
    convexSiteUrl: env.PLAYWRIGHT_LOCAL_AUTH_CONVEX_SITE_URL ?? DEFAULT_CONVEX_SITE_URL,
    convexUrl: env.PLAYWRIGHT_LOCAL_AUTH_CONVEX_URL ?? DEFAULT_CONVEX_URL,
    playwrightArgs: withDefaultRetries(
      playwrightArgs.length > 0 ? playwrightArgs : DEFAULT_PLAYWRIGHT_ARGS,
    ),
  };
}
