export function experimentalClawsEnabled(env: Record<string, string | undefined> = process.env) {
  return env.CLAWHUB_EXPERIMENTAL_CLAWS === "1";
}

export const OPENCLAW_CLAW_SCOPE = "@openclaw/";

export function isOpenClawClawName(name: string) {
  return name.startsWith(OPENCLAW_CLAW_SCOPE) && name.length > OPENCLAW_CLAW_SCOPE.length;
}

export function isOpenClawClawPublisher(
  owner:
    | { kind?: string; handle?: string; deletedAt?: number; deactivatedAt?: number }
    | null
    | undefined,
) {
  return (
    owner?.kind === "org" &&
    owner.handle === "openclaw" &&
    owner.deletedAt === undefined &&
    owner.deactivatedAt === undefined
  );
}

export function isClawFamilyPubliclyVisible(
  family: string,
  env: Record<string, string | undefined> = process.env,
) {
  return family !== "claw" || experimentalClawsEnabled(env);
}
