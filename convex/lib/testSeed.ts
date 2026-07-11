type TestSeedEnv = {
  CLAWHUB_DEPLOYMENT_NAME?: string;
  CLAWHUB_DISABLE_CRONS?: string;
  CLAWHUB_ENV?: string;
};

const TEST_DEPLOYMENT = "academic-chihuahua-392";

export function assertTestSeedAllowed(env: TestSeedEnv = process.env): void {
  if (env.CLAWHUB_ENV !== "test") {
    throw new Error("Test seed requires CLAWHUB_ENV=test");
  }
  if (env.CLAWHUB_DISABLE_CRONS !== "1") {
    throw new Error("Test seed requires CLAWHUB_DISABLE_CRONS=1");
  }
  if (env.CLAWHUB_DEPLOYMENT_NAME !== TEST_DEPLOYMENT) {
    throw new Error(`Test seed requires CLAWHUB_DEPLOYMENT_NAME=${TEST_DEPLOYMENT}`);
  }
}
