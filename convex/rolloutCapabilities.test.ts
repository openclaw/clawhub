/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { getPublicCapabilitiesHandler } from "./rolloutCapabilities";

function createControlDb(control: Record<string, unknown> | null) {
  const unique = vi.fn(async () => control);
  const withIndex = vi.fn((_name: string, build: (query: { eq: () => unknown }) => unknown) => {
    build({ eq: () => undefined });
    return { unique };
  });
  return {
    db: {
      query: vi.fn(() => ({ withIndex })),
    },
    unique,
  };
}

describe("getPublicCapabilitiesHandler", () => {
  it("returns a fully dark response without reading controls when runtime modes are off", async () => {
    const { db, unique } = createControlDb({
      mode: "staging-live",
      paused: false,
      discoveryEnabled: true,
      writesEnabled: true,
      publicVisibilityEnabled: true,
      scanPlanningEnabled: true,
      scanAdmissionEnabled: true,
    });

    await expect(getPublicCapabilitiesHandler({ db } as never, {})).resolves.toEqual({
      environment: "unknown",
      catalogDiscovery: {
        apiVersion: 1,
        canonicalTrendingEnabled: true,
      },
      skillsSh: {
        mode: "off",
        runtimeEnabled: false,
        discoveryEnabled: false,
        writesEnabled: false,
        publicCatalogEnabled: false,
        scanPlanningEnabled: false,
        scanAdmissionEnabled: false,
      },
      githubSkillSync: {
        mode: "off",
        selfServiceEnabled: false,
      },
    });
    expect(unique).not.toHaveBeenCalled();
  });

  it("requires the skills.sh database controls in addition to Test runtime mode", async () => {
    const { db } = createControlDb({
      mode: "staging-live",
      paused: false,
      discoveryEnabled: true,
      writesEnabled: true,
      publicVisibilityEnabled: false,
      scanPlanningEnabled: true,
      scanAdmissionEnabled: false,
    });

    await expect(
      getPublicCapabilitiesHandler({ db } as never, {
        CLAWHUB_ENV: "test",
        CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "test",
        CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE: "test",
      }),
    ).resolves.toEqual({
      environment: "test",
      catalogDiscovery: {
        apiVersion: 1,
        canonicalTrendingEnabled: true,
      },
      skillsSh: {
        mode: "test",
        runtimeEnabled: true,
        discoveryEnabled: true,
        writesEnabled: true,
        publicCatalogEnabled: false,
        scanPlanningEnabled: true,
        scanAdmissionEnabled: false,
      },
      githubSkillSync: {
        mode: "test",
        selfServiceEnabled: true,
      },
    });
  });

  it("treats the mirror public gate independently from preserved legacy operator controls", async () => {
    const { db } = createControlDb({
      mode: "off",
      paused: true,
      discoveryEnabled: false,
      writesEnabled: false,
      publicVisibilityEnabled: true,
      mirrorPublicVisibilityEnabled: true,
      scanPlanningEnabled: false,
      scanAdmissionEnabled: false,
    });

    await expect(
      getPublicCapabilitiesHandler({ db } as never, {
        CLAWHUB_ENV: "test",
        CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "test",
      }),
    ).resolves.toMatchObject({
      skillsSh: {
        discoveryEnabled: true,
        publicCatalogEnabled: true,
        writesEnabled: false,
        scanPlanningEnabled: false,
        scanAdmissionEnabled: false,
      },
    });
  });

  it("does not reinterpret the legacy visibility bit as verified mirror activation", async () => {
    const { db } = createControlDb({
      mode: "off",
      paused: true,
      discoveryEnabled: false,
      writesEnabled: false,
      publicVisibilityEnabled: true,
      scanPlanningEnabled: false,
      scanAdmissionEnabled: false,
    });

    await expect(
      getPublicCapabilitiesHandler({ db } as never, {
        CLAWHUB_ENV: "production",
        CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "production",
      }),
    ).resolves.toMatchObject({
      skillsSh: {
        discoveryEnabled: false,
        publicCatalogEnabled: false,
      },
    });
  });
});
