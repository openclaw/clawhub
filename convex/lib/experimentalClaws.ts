export function experimentalClawsEnabled(env: Record<string, string | undefined> = process.env) {
  return env.CLAWHUB_EXPERIMENTAL_CLAWS === "1";
}

export function isClawFamilyPubliclyVisible(
  family: string,
  env: Record<string, string | undefined> = process.env,
) {
  return family !== "claw" || experimentalClawsEnabled(env);
}
