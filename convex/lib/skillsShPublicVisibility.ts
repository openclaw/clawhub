import { getClawHubRolloutCapabilities, type ClawHubRolloutEnvironment } from "clawhub-schema";
import type { SkillsShMirrorDigest } from "./skillsShMirrorPublic";
import { buildUnclaimedSkillsShInstallResolution } from "./skillsShMirrorPublic";

export const ACTIVATE_SKILLS_SH_PUBLIC_TEST_CONFIRM = "activate-skills-sh-public-test";
export const DEACTIVATE_SKILLS_SH_PUBLIC_TEST_CONFIRM = "deactivate-skills-sh-public-test";
export const ACTIVATE_SKILLS_SH_PUBLIC_PRODUCTION_CONFIRM = "activate-skills-sh-public-production";
export const DEACTIVATE_SKILLS_SH_PUBLIC_PRODUCTION_CONFIRM =
  "deactivate-skills-sh-public-production";

export function assertSkillsShPublicVisibilityMutationAllowed(args: {
  activate: boolean;
  confirm: string;
  env?: ClawHubRolloutEnvironment;
}) {
  const capabilities = getClawHubRolloutCapabilities(args.env ?? process.env);
  if (!capabilities.skillsSh.runtimeEnabled) {
    throw new Error("skills.sh catalog rollout is disabled");
  }

  const expectedConfirm =
    capabilities.environment === "production"
      ? args.activate
        ? ACTIVATE_SKILLS_SH_PUBLIC_PRODUCTION_CONFIRM
        : DEACTIVATE_SKILLS_SH_PUBLIC_PRODUCTION_CONFIRM
      : args.activate
        ? ACTIVATE_SKILLS_SH_PUBLIC_TEST_CONFIRM
        : DEACTIVATE_SKILLS_SH_PUBLIC_TEST_CONFIRM;

  if (
    !["local", "test", "production"].includes(capabilities.environment) ||
    args.confirm !== expectedConfirm
  ) {
    throw new Error("skills.sh public visibility confirmation is invalid");
  }
  return capabilities.environment;
}

export function isSkillsShMirrorDigestEligible(digest: SkillsShMirrorDigest) {
  return (
    buildUnclaimedSkillsShInstallResolution({
      ...digest,
      publicVisible: true,
      installable: true,
    }) !== null
  );
}

export function isSkillsShMirrorSourceEligible(digest: SkillsShMirrorDigest) {
  return isSkillsShMirrorDigestEligible({
    ...digest,
    active: true,
    publicVisible: true,
    installable: true,
  });
}

export function skillsShMirrorPublicationFlags(digest: SkillsShMirrorDigest) {
  const claimAllowsPublication =
    digest.claimStatus === undefined ||
    (digest.claimStatus === "pending" && digest.claimAttempt === 1);
  const eligible = claimAllowsPublication && isSkillsShMirrorDigestEligible(digest);
  return {
    publicVisible: eligible,
    installable: eligible,
  };
}

export function skillsShMirrorFreshObservationFlags(digest: SkillsShMirrorDigest) {
  // Only the first production corpus is hidden behind the global gate. Once
  // activated, exact eligible hourly observations publish row-by-row so
  // healthy rows stay live while a bad source remains row-scoped.
  const active =
    digest.claimStatus === undefined ||
    (digest.claimStatus === "pending" && digest.claimAttempt === 1);
  return {
    active,
    ...skillsShMirrorPublicationFlags({ ...digest, active }),
  };
}
