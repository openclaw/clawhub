import { beforeEach, describe, expect, it, vi } from "vitest";
import { listOfficialEntries } from "./catalogFeed";

vi.mock("./lib/publishers", () => ({
  getOwnerPublisher: vi.fn().mockResolvedValue({ handle: "openclaw" }),
}));
vi.mock("./lib/officialPublishers", () => ({
  isOfficialPublisher: vi.fn().mockResolvedValue(true),
}));

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const listOfficialEntriesHandler = (
  listOfficialEntries as unknown as WrappedHandler<
    { family: "code-plugin" | "bundle-plugin" },
    unknown[]
  >
)._handler;

function makePackage(overrides: Record<string, unknown> = {}) {
  return {
    _id: "packages:1",
    name: "@openclaw/demo",
    normalizedName: "@openclaw/demo",
    displayName: "Demo",
    ownerUserId: "users:1",
    family: "code-plugin",
    channel: "official",
    isOfficial: true,
    latestReleaseId: "packageReleases:1",
    softDeletedAt: undefined,
    ...overrides,
  };
}

function makeRelease(overrides: Record<string, unknown> = {}) {
  return {
    packageId: "packages:1",
    version: "1.2.3",
    integritySha256: "ignored",
    artifactKind: "legacy-zip",
    sha256hash: "artifact-hash",
    verification: { scanStatus: "clean" },
    manualModeration: undefined,
    softDeletedAt: undefined,
    ...overrides,
  };
}

function makeCtx(packages: unknown[], releases: Record<string, unknown>) {
  return {
    db: {
      query: vi.fn(() => {
        const query = {
          eq: vi.fn(() => query),
        };
        return {
          withIndex: vi.fn((_index: string, apply: (value: typeof query) => unknown) => {
            apply(query);
            return {
              order: vi.fn(() => ({
                paginate: vi.fn(async () => ({
                  page: packages,
                  isDone: true,
                  continueCursor: "",
                })),
              })),
            };
          }),
        };
      }),
      get: vi.fn(async (id: string) => releases[id] ?? null),
    },
  };
}

describe("catalog feed projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("projects official releases into ClawHub install candidates", async () => {
    const result = await listOfficialEntriesHandler(
      makeCtx([makePackage()], {
        "packageReleases:1": makeRelease(),
      }),
      { family: "code-plugin" },
    );

    expect(result).toEqual([
      {
        type: "plugin",
        id: "@openclaw/demo",
        title: "Demo",
        version: "1.2.3",
        state: "available",
        publisher: { id: "openclaw", trust: "official" },
        install: {
          candidates: [
            {
              sourceRef: "public-clawhub",
              package: "@openclaw/demo",
              version: "1.2.3",
              integrity: "sha256:artifact-hash",
            },
          ],
        },
      },
    ]);
  });

  it("excludes non-official, blocked, deleted, and undigested releases", async () => {
    const result = await listOfficialEntriesHandler(
      makeCtx(
        [
          makePackage({ name: "@openclaw/community", channel: "community" }),
          makePackage({ name: "@openclaw/deleted", softDeletedAt: 1 }),
          makePackage({ name: "@openclaw/malicious", latestReleaseId: "packageReleases:2" }),
          makePackage({ name: "@openclaw/no-hash", latestReleaseId: "packageReleases:3" }),
        ],
        {
          "packageReleases:1": makeRelease(),
          "packageReleases:2": makeRelease({ manualModeration: { state: "quarantined" } }),
          "packageReleases:3": makeRelease({ sha256hash: undefined }),
        },
      ),
      { family: "code-plugin" },
    );

    expect(result).toEqual([]);
  });

  it("re-checks the live official publisher record", async () => {
    const { isOfficialPublisher } = await import("./lib/officialPublishers");
    vi.mocked(isOfficialPublisher).mockResolvedValueOnce(false);

    const result = await listOfficialEntriesHandler(
      makeCtx([makePackage()], {
        "packageReleases:1": makeRelease(),
      }),
      { family: "code-plugin" },
    );

    expect(result).toEqual([]);
  });

  it("rejects a latest-release pointer for another package", async () => {
    const result = await listOfficialEntriesHandler(
      makeCtx([makePackage({ _id: "packages:2" })], {
        "packageReleases:1": makeRelease(),
      }),
      { family: "code-plugin" },
    );

    expect(result).toEqual([]);
  });
});
