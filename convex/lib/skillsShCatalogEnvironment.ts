type SkillsShCatalogEnvironment = {
  CLAWHUB_DEPLOYMENT_NAME?: string;
  CLAWHUB_DISABLE_CRONS?: string;
  CLAWHUB_ENV?: string;
  CLAWHUB_PREVIEW?: string;
  CONVEX_CLOUD_URL?: string;
  CONVEX_DEPLOYMENT?: string;
  CONVEX_SITE_URL?: string;
  DEV_AUTH_CONVEX_DEPLOYMENT?: string;
};

export type SkillsShFixtureEnvironmentPolicy =
  | {
      allowed: true;
      environment: "local" | "test";
    }
  | {
      allowed: false;
      environment: "preview" | "test" | "production" | "unknown";
      reason: string;
    };

const TEST_DEPLOYMENT = "academic-chihuahua-392";
const TEST_CLOUD_URL = `https://${TEST_DEPLOYMENT}.convex.cloud`;
const TEST_SITE_URL = `https://${TEST_DEPLOYMENT}.convex.site`;

function populatedRuntimeUrls(env: SkillsShCatalogEnvironment) {
  return [
    { actual: env.CONVEX_CLOUD_URL?.trim(), expectedTest: TEST_CLOUD_URL },
    { actual: env.CONVEX_SITE_URL?.trim(), expectedTest: TEST_SITE_URL },
  ].filter((entry): entry is { actual: string; expectedTest: string } => Boolean(entry.actual));
}

function isLocalRuntimeUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname;
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

export function getSkillsShFixtureEnvironmentPolicy(
  env: SkillsShCatalogEnvironment = process.env,
): SkillsShFixtureEnvironmentPolicy {
  if (env.CLAWHUB_PREVIEW === "1") {
    return {
      allowed: false,
      environment: "preview",
      reason: "skills.sh catalog fixture work is disabled in Preview",
    };
  }

  const deployment = env.CONVEX_DEPLOYMENT?.trim() || env.DEV_AUTH_CONVEX_DEPLOYMENT?.trim() || "";
  if (deployment.startsWith("prod:")) {
    return {
      allowed: false,
      environment: "production",
      reason: "skills.sh catalog fixture work is disabled in production",
    };
  }

  if (env.CLAWHUB_ENV === "test") {
    if (env.CLAWHUB_DISABLE_CRONS !== "1") {
      return {
        allowed: false,
        environment: "test",
        reason: "skills.sh Test fixture work requires CLAWHUB_DISABLE_CRONS=1",
      };
    }
    if (env.CLAWHUB_DEPLOYMENT_NAME !== TEST_DEPLOYMENT) {
      return {
        allowed: false,
        environment: "test",
        reason: `skills.sh Test fixture work requires CLAWHUB_DEPLOYMENT_NAME=${TEST_DEPLOYMENT}`,
      };
    }
    const runtimeUrls = populatedRuntimeUrls(env);
    if (
      runtimeUrls.length === 0 ||
      runtimeUrls.some((entry) => entry.actual !== entry.expectedTest)
    ) {
      return {
        allowed: false,
        environment: "test",
        reason: `skills.sh Test fixture work requires the ${TEST_DEPLOYMENT} Convex runtime URL`,
      };
    }
    return { allowed: true, environment: "test" };
  }

  if (env.CLAWHUB_DEPLOYMENT_NAME) {
    return {
      allowed: false,
      environment: "production",
      reason: "skills.sh catalog fixture work is disabled in production",
    };
  }
  const runtimeUrls = populatedRuntimeUrls(env);
  if (runtimeUrls.length > 0 && runtimeUrls.every((entry) => isLocalRuntimeUrl(entry.actual))) {
    return { allowed: true, environment: "local" };
  }
  return {
    allowed: false,
    environment: "unknown",
    reason: "skills.sh catalog fixture work requires an explicit local or Test environment",
  };
}

export function assertSkillsShFixtureEnvironmentAllowed(
  env: SkillsShCatalogEnvironment = process.env,
) {
  const policy = getSkillsShFixtureEnvironmentPolicy(env);
  if (!policy.allowed) throw new Error(policy.reason);
  return policy;
}

export function assertSkillsShCatalogControlMutationAllowed(
  env: SkillsShCatalogEnvironment = process.env,
) {
  if (env.CLAWHUB_PREVIEW === "1") {
    throw new Error("skills.sh catalog control mutations are disabled in Preview");
  }
}
