import { vi } from "vitest";
import type { SkillDetailPageViewProps } from "../../components/SkillDetailPageView";

export function makeSkillDetailPageViewProps(
  overrides: Pick<SkillDetailPageViewProps, "skill"> & Partial<SkillDetailPageViewProps>,
): SkillDetailPageViewProps {
  return {
    owner: null,
    ownerHandle: "publisher",
    latestVersion: null,
    modInfo: null,
    canManage: false,
    isAuthenticated: false,
    isStaff: false,
    isStarred: false,
    onToggleStar: vi.fn(),
    onOpenReport: vi.fn(),
    onRequireSignIn: vi.fn(),
    forkOf: null,
    forkOfLabel: "fork of",
    forkOfHref: null,
    forkOfOwnerHandle: null,
    canonical: null,
    canonicalHref: null,
    canonicalOwnerHandle: null,
    staffVisibilityTag: null,
    isAutoHidden: false,
    isRemoved: false,
    nixPlugin: undefined,
    hasPluginBundle: false,
    configRequirements: undefined,
    cliHelp: undefined,
    ...overrides,
  };
}
