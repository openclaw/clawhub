import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmAnalysis } from "../../../components/securityAuditModel";
import { TemplateDetailPage } from "../../../components/TemplateDetailPage";
import type { PackageDetailResponse } from "../../../lib/packageApi";
import { getTemplateManifestPath, parseTemplateDocument } from "../../../lib/templateDetail";

const mocks = vi.hoisted(() => ({
  fetchPackageDetail: vi.fn(),
  fetchPackageFile: vi.fn(),
  fetchPackageVersion: vi.fn(),
}));

vi.mock("nitro/app", () => ({ serverFetch: (url: string, init: RequestInit) => fetch(url, init) }));
vi.mock("../../../lib/packageApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/packageApi")>()),
  ...mocks,
}));
// Exercise the real sanitized Markdown renderer without asynchronous syntax-engine setup.
vi.mock("../../../components/MarkdownPreview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../components/MarkdownPreview")>();
  return {
    ...actual,
    MarkdownPreview: (props: { children: string; className?: string }) => (
      <actual.MarkdownPreview {...props} highlight={false} />
    ),
  };
});

import { loadPublisherTemplate, Route } from "./$slug";

function packageDetail(family: "template" | "code-plugin" = "template"): PackageDetailResponse {
  return {
    package: {
      name: "@maker/release-brief",
      displayName: "Release Brief",
      family,
      channel: "community",
      isOfficial: false,
      summary: "Summarizes releases for a new user.",
      tags: [],
      ownerHandle: "maker",
      createdAt: 1,
      updatedAt: 2,
      latestVersion: "0.1.0",
      templateManifestSummary: {
        schemaVersion: 1,
        agent: { id: "release-brief", name: "Release Brief" },
        workspace: { bootstrapFiles: [], fileCount: 2 },
        packages: { skillCount: 1, pluginCount: 0 },
        mcpServerCount: 0,
        cronJobCount: 0,
      },
    },
    owner: { handle: "maker", displayName: "Maker", image: null },
  } as PackageDetailResponse;
}

function publicInventory() {
  const sha256 = "a".repeat(64),
    npmIntegrity = "sha512-" + "A".repeat(86) + "==";
  return {
    schemaVersion: 1 as const,
    packageName: "@maker/release-brief",
    version: "0.1.0",
    artifact: { kind: "npm-pack" as const, sha256, npmIntegrity },
    templateManifestSummary: packageDetail().package!.templateManifestSummary!,
    manifestPath: "template/CLAW.md",
    icon: null,
    contents: {
      instructions: [
        { name: "skills/review-notes/SKILL.md", source: "workspace/skills/review-notes/SKILL.md" },
      ],
      skills: [
        { name: "release-triage", source: "bundled" as const, path: "skills/release-triage" },
      ],
      integrations: [
        {
          kind: "plugin" as const,
          name: "release-watcher",
          source: "bundled" as const,
          path: "plugins/release-watcher",
        },
      ],
      automations: [
        { name: "Weekly report", enabled: false, schedule: "0 17 * * 5", timezone: "UTC" },
      ],
    },
    security: {
      package: { name: "@maker/release-brief", family: "template" as const },
      release: {
        version: "0.1.0",
        artifactKind: "npm-pack" as const,
        artifactSha256: sha256,
        npmIntegrity,
      },
      verdict: "benign",
      overview: "Published audit",
      securityAuditUrl: "https://example.invalid/audit",
      trust: {
        blockedFromDownload: false,
        pending: false,
        stale: false,
        reasons: [],
        scanStatus: "clean" as const,
      },
    },
  };
}

describe("publisher Template detail route loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchPackageVersion.mockResolvedValue(null);
    mocks.fetchPackageFile.mockResolvedValue("# Release Brief");
  });

  it("returns exact, digest-bound inventory without reading preview bytes", async () => {
    const detail = packageDetail();
    const templateInventory = publicInventory();
    mocks.fetchPackageDetail.mockResolvedValue({ ...detail, templateInventory });
    const loaded = await loadPublisherTemplate({ owner: "maker", slug: "release-brief" });
    expect(loaded.inventory?.contents.skills[0]?.name).toBe("release-triage");
    expect(loaded.contents).toBeNull();
    expect(mocks.fetchPackageFile).not.toHaveBeenCalled();
    expect(mocks.fetchPackageVersion).not.toHaveBeenCalled();
  });

  it.each(["digest", "version", "owner", "hold", "path", "partial", "channel"])(
    "does not use or refetch an invalid %s projection",
    async (problem) => {
      const detail = packageDetail();
      const value = publicInventory();
      if (problem === "channel") Object.assign(detail.package!, { channel: "unsupported" });
      if (problem === "digest") value.security.release.artifactSha256 = "b".repeat(64);
      if (problem === "version") value.version = "0.0.1";
      if (problem === "owner") value.packageName = "@unrelated/release-brief";
      if (problem === "hold") value.security.trust.blockedFromDownload = true;
      if (problem === "path") value.manifestPath = "../not-mine/CLAW.md";
      if (problem === "partial") Object.assign(value.contents, { instructions: undefined });
      mocks.fetchPackageDetail.mockResolvedValue({ ...detail, templateInventory: value });
      await expect(
        loadPublisherTemplate({ owner: "maker", slug: "release-brief" }),
      ).rejects.toThrow(/inventory/i);
      expect(mocks.fetchPackageFile).not.toHaveBeenCalled();
      expect(mocks.fetchPackageVersion).not.toHaveBeenCalled();
    },
  );

  it("rejects a present but invalid inventory without falling back to file or audit reads", async () => {
    mocks.fetchPackageDetail.mockResolvedValue({ ...packageDetail(), templateInventory: null });
    await expect(loadPublisherTemplate({ owner: "maker", slug: "release-brief" })).rejects.toThrow(
      /inventory/i,
    );
    expect(mocks.fetchPackageDetail).toHaveBeenCalledWith(
      "@maker/release-brief",
      "template-inventory",
    );
    expect(mocks.fetchPackageFile).not.toHaveBeenCalled();
    expect(mocks.fetchPackageVersion).not.toHaveBeenCalled();
  });

  it("uses a single authorized package snapshot without fetching unrelated file bodies", async () => {
    const llmAnalysis = { status: "suspicious", checkedAt: 1, summary: "Review permissions." };
    mocks.fetchPackageDetail.mockResolvedValue({
      ...packageDetail(),
      templateRelease: { version: "0.1.0", contents: "# From this release", llmAnalysis },
    });
    const loaded = await loadPublisherTemplate({ owner: "maker", slug: "release-brief" });
    expect(loaded.contents).toBe("# From this release");
    expect(loaded.llmAnalysis).toEqual(llmAnalysis);
    expect(mocks.fetchPackageDetail).toHaveBeenCalledWith(
      "@maker/release-brief",
      "template-inventory",
    );
    expect(mocks.fetchPackageFile).not.toHaveBeenCalled();
    expect(mocks.fetchPackageVersion).not.toHaveBeenCalled();
  });

  it("never substitutes stale or blocked snapshot content for the pinned release", async () => {
    mocks.fetchPackageDetail.mockResolvedValue({
      ...packageDetail(),
      templateRelease: { version: "0.0.9", contents: "wrong version", llmAnalysis: null },
    });
    expect((await loadPublisherTemplate({ owner: "maker", slug: "release-brief" })).contents).toBe(
      "# Release Brief",
    );
    mocks.fetchPackageFile.mockClear();
    mocks.fetchPackageDetail.mockResolvedValue({
      ...packageDetail(),
      templateRelease: { version: "0.1.0", contents: null, llmAnalysis: null },
    });
    expect(
      (await loadPublisherTemplate({ owner: "maker", slug: "release-brief" })).contents,
    ).toBeNull();
    expect(mocks.fetchPackageFile).not.toHaveBeenCalled();
  });

  it.each(["private", "malicious"] as const)(
    "preserves the viewer-authorized file and audit path for %s releases",
    async (state) => {
      const detail = packageDetail();
      if (state === "private") detail.package!.channel = "private";
      else detail.package!.scanStatus = "malicious";
      const audit = { status: state === "private" ? "benign" : "malicious", checkedAt: 1 };
      // The public snapshot deliberately does not embed private or held release data.
      mocks.fetchPackageDetail.mockResolvedValue({
        ...detail,
        templateRelease: { version: "0.1.0", contents: null, llmAnalysis: null },
      });
      mocks.fetchPackageVersion.mockResolvedValue({
        version: { version: "0.1.0", llmAnalysis: audit },
      });
      const authorizedPreview = state === "private" ? "# Private owner preview" : null;
      mocks.fetchPackageFile.mockResolvedValue(authorizedPreview);
      const loaded = await loadPublisherTemplate({ owner: "maker", slug: "release-brief" });
      expect(loaded.contents).toBe(authorizedPreview);
      expect(loaded.llmAnalysis).toEqual(audit);
      expect(mocks.fetchPackageFile).toHaveBeenCalledWith(
        "@maker/release-brief",
        "CLAW.md",
        "0.1.0",
      );
    },
  );

  it("exposes a single live announcement and noninteractive detail placeholders while pending", () => {
    const Pending = Route.options.pendingComponent;
    if (!Pending) throw new Error("Missing pending route");
    const { container } = render(<Pending />);
    expect(screen.getByRole("status").textContent).toBe("Loading Template details…");
    expect(screen.getByRole("status").classList.contains("sr-only")).toBe(true);
    expect(screen.getByRole("status").closest('[aria-busy="true"]')).toBeNull();
    expect(screen.getByRole("main").getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector('[aria-hidden="true"] .catalog-detail__hero')).not.toBeNull();
    expect(container.querySelector('[aria-hidden="true"] .catalog-detail__content')).not.toBeNull();
    expect(container.querySelector("button, a, [tabindex]")).toBeNull();
    expect(container.querySelector('[aria-hidden="true"] .template-catalog-panel')).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Included in this release" })).toBeNull();
  });

  it("loads only a public Template owned by the requested publisher", async () => {
    mocks.fetchPackageDetail.mockResolvedValue(packageDetail());

    const loaded = await loadPublisherTemplate({ owner: "maker", slug: "release-brief" });

    expect(loaded.detail.package?.family).toBe("template");
    expect(loaded.contents).toBe("# Release Brief");
    expect(mocks.fetchPackageFile).toHaveBeenCalledWith("@maker/release-brief", "CLAW.md", "0.1.0");
  });

  it("loads the actual audit from the pinned latest release, not the package scan flag", async () => {
    mocks.fetchPackageDetail.mockResolvedValue(packageDetail());
    const llmAnalysis = { status: "suspicious", checkedAt: 1, summary: "Review permissions." };
    mocks.fetchPackageVersion.mockResolvedValue({ version: { version: "0.1.0", llmAnalysis } });
    const loaded = await loadPublisherTemplate({ owner: "maker", slug: "release-brief" });
    expect(mocks.fetchPackageVersion).toHaveBeenCalledWith("@maker/release-brief", "0.1.0");
    expect(loaded.llmAnalysis).toEqual(llmAnalysis);
  });

  it.each([
    null,
    { version: { version: "0.0.9", llmAnalysis: { status: "clean", checkedAt: 1 } } },
  ])("keeps missing or mismatched release audit evidence unavailable: %j", async (release) => {
    mocks.fetchPackageDetail.mockResolvedValue(packageDetail());
    mocks.fetchPackageVersion.mockResolvedValue(release);
    const loaded = await loadPublisherTemplate({ owner: "maker", slug: "release-brief" });
    expect(loaded.llmAnalysis).toBeNull();
    expect(loaded.contents).toBe("# Release Brief");
  });

  it("normalizes an at-prefixed publisher route before checking package ownership", async () => {
    mocks.fetchPackageDetail.mockResolvedValue(packageDetail());

    const loaded = await loadPublisherTemplate({ owner: "@Maker", slug: "release-brief" });

    expect(loaded.detail.package?.family).toBe("template");
    expect(mocks.fetchPackageDetail).toHaveBeenCalledWith(
      "@maker/release-brief",
      "template-inventory",
    );
  });

  it("does not expose a plugin at a Template URL", async () => {
    mocks.fetchPackageDetail.mockResolvedValue(packageDetail("code-plugin"));

    await expect(
      loadPublisherTemplate({ owner: "maker", slug: "release-brief" }),
    ).rejects.toMatchObject({ isNotFound: true });
    expect(mocks.fetchPackageFile).not.toHaveBeenCalled();
  });

  it("does not expose another publisher's package", async () => {
    mocks.fetchPackageDetail.mockResolvedValue({
      ...packageDetail(),
      owner: { handle: "someone-else" },
    });

    await expect(
      loadPublisherTemplate({ owner: "maker", slug: "release-brief" }),
    ).rejects.toMatchObject({ isNotFound: true });
    expect(mocks.fetchPackageFile).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

describe("publisher Template route invariants", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.fetchPackageVersion.mockResolvedValue(null);
    mocks.fetchPackageFile.mockResolvedValue("# Release Brief");
  });

  it("falls back to an unscoped package only when its owner matches", async () => {
    const detail = packageDetail();
    detail.package!.name = "release-brief";
    mocks.fetchPackageDetail
      .mockResolvedValueOnce({ package: null, owner: null })
      .mockResolvedValueOnce(detail);
    const loaded = await loadPublisherTemplate({ owner: "maker", slug: "release-brief" });
    expect(loaded.detail.package?.name).toBe("release-brief");
    expect(mocks.fetchPackageDetail.mock.calls).toEqual([
      ["@maker/release-brief", "template-inventory"],
      ["release-brief", "template-inventory"],
    ]);
    expect(mocks.fetchPackageFile).toHaveBeenCalledWith("release-brief", "CLAW.md", "0.1.0");
  });

  it("rejects an unscoped fallback owned by somebody else", async () => {
    mocks.fetchPackageDetail
      .mockResolvedValueOnce({ package: null, owner: null })
      .mockResolvedValueOnce({ ...packageDetail(), owner: { handle: "other" } });
    await expect(
      loadPublisherTemplate({ owner: "maker", slug: "release-brief" }),
    ).rejects.toMatchObject({ isNotFound: true });
    expect(mocks.fetchPackageFile).not.toHaveBeenCalled();
  });

  it("does not request files without a release", async () => {
    const detail = packageDetail();
    detail.package!.latestVersion = null;
    mocks.fetchPackageDetail.mockResolvedValue(detail);
    expect(
      (await loadPublisherTemplate({ owner: "maker", slug: "release-brief" })).contents,
    ).toBeNull();
    expect(mocks.fetchPackageFile).not.toHaveBeenCalled();
    expect(mocks.fetchPackageVersion).not.toHaveBeenCalled();
  });

  it("reads the package's declared nested CLAW.md at the pinned release", async () => {
    mocks.fetchPackageDetail.mockResolvedValue(packageDetail());
    mocks.fetchPackageFile.mockImplementation(async (_name, path) =>
      path === "package.json"
        ? JSON.stringify({ openclaw: { template: "template/CLAW.md" } })
        : path === "template/CLAW.md"
          ? "# Nested instructions"
          : null,
    );
    expect((await loadPublisherTemplate({ owner: "maker", slug: "release-brief" })).contents).toBe(
      "# Nested instructions",
    );
    expect(mocks.fetchPackageFile).toHaveBeenCalledWith(
      "@maker/release-brief",
      "template/CLAW.md",
      "0.1.0",
    );
  });

  it("keeps registry errors as errors rather than reporting a missing Template", async () => {
    mocks.fetchPackageDetail.mockRejectedValue(new Error("Registry unavailable"));
    await expect(loadPublisherTemplate({ owner: "maker", slug: "release-brief" })).rejects.toThrow(
      "Registry unavailable",
    );
  });

  it("advertises the same absolute full-size image to Open Graph and Twitter", async () => {
    const detail = packageDetail();
    detail.package!.displayName = detail.package!.name;
    const head = Route.options.head!;
    const result = await head({ loaderData: { detail } } as Parameters<typeof head>[0]);
    const image =
      "https://clawhub.ai/og/template.png?v=2&name=%40maker%2Frelease-brief&owner=maker&version=0.1.0";
    expect(result?.meta).toEqual(
      expect.arrayContaining([
        { title: "Release Brief — ClawHub Templates" },
        { property: "og:image", content: image },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: image },
      ]),
    );
    expect(result?.links).toEqual([
      { rel: "canonical", href: "https://clawhub.ai/maker/templates/release-brief" },
    ]);
    detail.package!.channel = "private";
    expect(await head({ loaderData: { detail } } as Parameters<typeof head>[0])).toEqual({});
  });

  it("redirects aliases to the actual package's canonical publisher URL", async () => {
    const detail = packageDetail();
    detail.package!.name = "@maker/canonical-brief";
    mocks.fetchPackageDetail.mockResolvedValue(detail);
    const loader = Route.options.loader;
    if (typeof loader !== "function") throw new Error("Expected route loader");
    await expect(
      loader({ params: { owner: "maker", slug: "release-brief" } } as Parameters<typeof loader>[0]),
    ).rejects.toMatchObject({
      options: { href: "/maker/templates/canonical-brief", replace: true },
    });
  });

  it("rejects malformed publisher routes before querying the registry", async () => {
    await expect(
      loadPublisherTemplate({ owner: "../maker", slug: "release-brief" }),
    ).rejects.toMatchObject({ isNotFound: true });
    expect(mocks.fetchPackageDetail).not.toHaveBeenCalled();
  });
});

const manifest = {
  schemaVersion: 1,
  agent: { id: "release-brief", name: "Release Brief" },
  categories: ["engineering"],
  workspace: {
    bootstrapFiles: { "AGENTS.md": { source: "workspace/AGENTS.md" } },
    files: [{ path: "notes/checklist.txt", source: "workspace/checklist.txt" }],
  },
  skills: [{ ref: "@maker/release-search", version: "1.2.3" }],
  plugins: [{ ref: "@maker/release-alerts", version: "2.0.0" }],
  automations: [
    {
      id: "weekday-brief",
      name: "Weekday release brief",
      enabled: false,
      schedule: { cron: "0 9 * * 1-5", timezone: "America/Los_Angeles" },
      session: "isolated",
      message: "Summarize the approved release sources.",
      delivery: { mode: "none" },
    },
  ],
};
const templateContents =
  "---\n" +
  JSON.stringify(manifest) +
  "\n---\n# Release instructions\n\nRead the actual release notes.";

function renderTemplate(
  options: {
    status?: NonNullable<PackageDetailResponse["package"]>["scanStatus"];
    contents?: string | null;
    version?: string | null;
    llmAnalysis?: LlmAnalysis | null;
    manifestSummary?: NonNullable<PackageDetailResponse["package"]>["templateManifestSummary"];
    name?: string;
    categories?: string[];
  } = {},
) {
  const detail = packageDetail();
  if (options.name) detail.package!.name = options.name;
  if (options.categories) detail.package!.categories = options.categories;
  detail.package!.scanStatus = "status" in options ? options.status : "clean";
  detail.package!.updatedAt = Date.UTC(2026, 10, 5);
  if ("version" in options) detail.package!.latestVersion = options.version;
  if ("manifestSummary" in options)
    detail.package!.templateManifestSummary = options.manifestSummary;
  detail.package!.artifact = {
    kind: "npm-pack",
    sha256: "a".repeat(64),
    size: 608,
    format: "tgz",
  };
  return render(
    <TemplateDetailPage
      detail={detail}
      contents={"contents" in options ? options.contents! : templateContents}
      fallbackOwner="maker"
      llmAnalysis={options.llmAnalysis}
    />,
  );
}

describe("Template detail composition and interactions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.fetchPackageVersion.mockResolvedValue(null);
    mocks.fetchPackageFile.mockResolvedValue("# Workspace instructions\n\nActual file contents.");
  });

  it("renders title, summary and personality without browsing files when the archive exceeds inventory capacity", async () => {
    const ordinary = packageDetail();
    ordinary.package!.scanStatus = "clean";
    const api =
      await vi.importActual<typeof import("../../../lib/packageApi")>("../../../lib/packageApi");
    const transport = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (typeof input !== "string") throw new Error("Expected a registry URL string");
      const u = new URL(input);
      if (u.searchParams.get("inventoryFallback") !== "website")
        return new Response("Template inventory too large", { status: 413 });
      return Response.json(ordinary);
    });
    try {
      mocks.fetchPackageDetail.mockImplementation(api.fetchPackageDetail);
      mocks.fetchPackageFile.mockImplementation((_name, path) =>
        Promise.resolve(
          path === "CLAW.md"
            ? templateContents
            : path === "package.json"
              ? "{}"
              : "# Pinned workspace preview",
        ),
      );
      const loaded = await loadPublisherTemplate({ owner: "maker", slug: "release-brief" });
      render(<TemplateDetailPage {...loaded} fallbackOwner="maker" />);
      expect(screen.getByRole("heading", { level: 1, name: "Release Brief" })).toBeTruthy();
      expect(screen.getByText("Summarizes releases for a new user.")).toBeTruthy();
      expect(transport).toHaveBeenCalledTimes(1);
      expect(mocks.fetchPackageFile.mock.calls.map((x) => x[1])).toEqual([
        "CLAW.md",
        "package.json",
      ]);
      fireEvent.click(screen.getByRole("button", { name: "SOUL.md" }));
      expect(
        within(screen.getByRole("dialog", { name: "SOUL.md" })).getByRole("heading", {
          name: "Release instructions",
        }),
      ).toBeTruthy();
      expect(screen.queryByText("Browse release files")).toBeNull();
      expect(mocks.fetchPackageFile).toHaveBeenCalledTimes(2);
    } finally {
      transport.mockRestore();
    }
  });
  it("shows the original document and migration link but never offers Add for a verified display-only release", async () => {
    const ordinary = packageDetail();
    ordinary.package!.scanStatus = "clean";
    const api =
      await vi.importActual<typeof import("../../../lib/packageApi")>("../../../lib/packageApi");
    const transport = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (typeof input !== "string") throw new Error("Expected a string registry URL");
      return new URL(input).searchParams.get("inventoryFallback") === "website"
        ? Response.json({ ...ordinary, templateDisplayOnly: true })
        : new Response("Template inventory could not be verified", { status: 422 });
    });
    try {
      mocks.fetchPackageDetail.mockImplementation(api.fetchPackageDetail);
      // A retired profile sidecar can accompany an otherwise valid, addable CLAW.md.
      mocks.fetchPackageFile.mockImplementation((_name, path) =>
        Promise.resolve(path === "package.json" ? "{}" : templateContents),
      );
      const data = await loadPublisherTemplate({ owner: "maker", slug: "release-brief" });
      render(<TemplateDetailPage {...data} fallbackOwner="maker" />);
      expect(screen.getByRole("heading", { level: 1, name: "Release Brief" })).toBeTruthy();
      expect(screen.getByText("View original CLAW.md").closest("details")?.textContent).toContain(
        templateContents,
      );
      expect(screen.getByRole("link", { name: "Template migration guide" })).toBeTruthy();
      expect(screen.queryByRole("link", { name: "Install in OpenClaw" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Copy template install command" })).toBeNull();
      expect(mocks.fetchPackageFile.mock.calls.every(([, , version]) => version === "0.1.0")).toBe(
        true,
      );
    } finally {
      transport.mockRestore();
    }
  });

  it("previews a named workspace skill at its pinned release while CLAW.md is pending", async () => {
    const detail = packageDetail();
    detail.package!.scanStatus = "clean";
    let finish!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    mocks.fetchPackageFile.mockImplementation((_name, path) =>
      path === "template/CLAW.md" ? pending : Promise.resolve("# Actual workspace preview"),
    );
    mocks.fetchPackageDetail.mockResolvedValue({ ...detail, templateInventory: publicInventory() });
    const loaded = await loadPublisherTemplate({ owner: "maker", slug: "release-brief" });
    render(<TemplateDetailPage {...loaded} fallbackOwner="maker" />);
    const included = screen.getByRole("region", { name: "Included in this release" });
    for (const name of ["release-triage", "review-notes", "release-watcher", "Weekly report"])
      expect(included.textContent).toContain(name);
    expect(included.textContent).toContain("0 17 * * 5");
    expect(included.textContent).toContain("UTC");
    expect(mocks.fetchPackageFile.mock.calls).toEqual([
      ["@maker/release-brief", "template/CLAW.md", "0.1.0"],
    ]);
    expect(
      screen
        .queryByRole("button", { name: "Copy template install command" })
        ?.hasAttribute("disabled") ?? true,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Browse release files" })).toBeNull();
    const row = within(included).getByRole("button", { name: "review-notes" });
    expect(mocks.fetchPackageFile).toHaveBeenCalledTimes(1);
    fireEvent.click(row);
    expect(await screen.findByRole("heading", { name: "Actual workspace preview" })).toBeTruthy();
    expect(mocks.fetchPackageFile).toHaveBeenLastCalledWith(
      "@maker/release-brief",
      "workspace/skills/review-notes/SKILL.md",
      "0.1.0",
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await act(async () => finish(templateContents));
    expect(
      screen
        .getByRole("button", { name: "Copy template install command" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("keeps an automation's wall-clock time in its declared zone after hydration", () => {
    const actual = Intl.DateTimeFormat().resolvedOptions();
    const zone = vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      ...actual,
      timeZone: "America/New_York",
    });
    try {
      renderTemplate();
      const trigger = screen.getByRole("button", { name: /^Weekday release brief/ });
      expect(trigger.textContent).toContain("Weekdays at 9:00 AM · America/Los_Angeles");
    } finally {
      zone.mockRestore();
    }
  });

  it("offers CLI and desktop install directly in the sidebar without an Add or Install proxy", () => {
    renderTemplate();
    const sidebar = screen.getByRole("complementary");
    const card = screen.getByRole("article", { name: "Install" });
    expect(sidebar.contains(card)).toBe(true);
    expect(screen.queryByRole("button", { name: /^(Add|Install)$/i })).toBeNull();
    expect(
      within(card).getByRole("button", { name: "Copy template install command" }),
    ).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Desktop" }));
    expect(
      within(card).getByRole("link", { name: "Install in OpenClaw" }).getAttribute("href"),
    ).toBe("openclaw://templates/install?name=%40maker%2Frelease-brief");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    { stored: ["household"], shown: "Household" },
    { stored: ["entertainment"], shown: "Entertainment" },
    // First-party listings were not rewritten and keep removed or several categories.
    { stored: ["personal"], shown: "Personal" },
    { stored: ["productivity", "people"], shown: "Productivity · People" },
  ])("labels the stored category $stored", ({ stored, shown }) => {
    renderTemplate({ categories: stored });
    expect(
      Array.from(
        document.querySelectorAll(".template-catalog-category"),
        (chip) => chip.textContent,
      ).join(" · ") || undefined,
    ).toBe(shown);
  });

  it.each([
    { declared: ["engineering", "operations"], shown: "Engineering" },
    { declared: ["travel", "personal"], shown: "Travel" },
    { declared: ["personal", "productivity"], shown: undefined },
    { declared: ["made-up"], shown: undefined },
  ])(
    "shows only the first declared category $declared before the registry assigns one",
    ({ declared, shown }) => {
      renderTemplate({
        contents:
          "---\n" + JSON.stringify({ ...manifest, categories: declared }) + "\n---\n# Brief",
      });
      expect(
        Array.from(
          document.querySelectorAll(".template-catalog-category"),
          (chip) => chip.textContent,
        ).join(" · ") || undefined,
      ).toBe(shown);
    },
  );

  it("renders an unclamped summary and swaps the personality excerpt for the full document", () => {
    renderTemplate();
    expect(screen.getByText("Summarizes releases for a new user.")).toBeTruthy();
    const personality = within(screen.getByRole("region", { name: "Personality" }));
    const toggle = personality.getByRole("button", { name: "Show more" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)?.textContent).toContain(
      "Read the actual release notes.",
    );
    fireEvent.click(toggle);
    expect(personality.getByRole("heading", { name: "Release instructions" })).toBeTruthy();
    fireEvent.click(personality.getByRole("button", { name: "Show less" }));
    expect(personality.queryByRole("heading", { name: "Release instructions" })).toBeNull();
  });

  it("shows Unavailable and neutral bars when a clean package has no release audit evidence", () => {
    renderTemplate();
    const metadata = screen.getByRole("complementary");
    expect(within(metadata).getByText("Unavailable")).toBeTruthy();
    expect(within(metadata).queryByText("Clean")).toBeNull();
    expect(metadata.querySelector(".security-audit-meter")?.getAttribute("data-level")).toBe("0");
  });

  it.each([
    ["benign", "Clean", "3"],
    ["suspicious", "Review", "2"],
    ["malicious", "Malicious", "1"],
    ["pending", "Pending", "0"],
    ["error", "Error", "0"],
  ])(
    "uses actual release evidence for %s instead of the package's clean flag",
    (verdict, label, level) => {
      renderTemplate({ llmAnalysis: { status: verdict, verdict, checkedAt: 1 } });
      const metadata = screen.getByRole("complementary");
      expect(within(metadata).getByText(label)).toBeTruthy();
      expect(metadata.querySelector(".security-audit-meter")?.getAttribute("data-level")).toBe(
        level,
      );
    },
  );

  it("matches the template overview and links the security verdict to this release", () => {
    renderTemplate();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe(
      "TemplatesRelease Brief",
    );
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("link", { name: "@maker" }).getAttribute("href")).toBe("/maker");
    expect(screen.getByText("Engineering")).toBeTruthy();
    expect(screen.queryByText(/schemaVersion/)).toBeNull();
    const facts = within(screen.getByRole("complementary"));
    const localDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
      Date.UTC(2026, 10, 5),
    );
    expect(facts.getByText(localDate)).toBeTruthy();
    expect(facts.getByText("0.1.0")).toBeTruthy();
    const audit = facts.getByRole("link", { name: /View Security Audit.*Unavailable/i });
    expect(audit.getAttribute("href")).toBe(
      "/maker/templates/release-brief/security-audit?version=0.1.0",
    );
    expect(within(audit).getByText("Unavailable")).toBeTruthy();
    expect(facts.queryByText(/^Audit$/i)).toBeNull();
  });

  it("reads a bundled skill's pinned SKILL.md only when its capability row opens", async () => {
    const detail = packageDetail();
    detail.package!.templateInventory = [
      { kind: "skill", source: "bundled", name: "Research", path: "skills/research" },
    ];
    render(
      <TemplateDetailPage detail={detail} contents={templateContents} fallbackOwner="maker" />,
    );
    expect(mocks.fetchPackageFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Research" }));
    const dialog = within(screen.getByRole("dialog", { name: "Research" }));
    expect(await dialog.findByRole("heading", { name: "Workspace instructions" })).toBeTruthy();
    expect(mocks.fetchPackageFile).toHaveBeenCalledWith(
      "@maker/release-brief",
      "skills/research/SKILL.md",
      "0.1.0",
    );
  });

  const skillMetadata = {
    slug: "release-search",
    publisherHandle: "maker",
    version: "1.2.3",
    resolvedFrom: "version",
    ok: false,
    reasons: ["card.missing"],
    artifact: {
      files: [
        {
          path: "SKILL.md",
          sha256: "0d01d0807cb0e9eb27ff2552a52f65ab01f690661856591b4eec023d4f93f0b9",
        },
      ],
    },
  };

  it("reads the publisher's pinned SKILL.md even when no generated card exists", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(skillMetadata))
      .mockResolvedValueOnce(new Response("# Authored instructions"));
    renderTemplate();
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "@maker/release-search" }));
    const dialog = within(screen.getByRole("dialog", { name: "@maker/release-search" }));
    expect(await dialog.findByRole("heading", { name: "Authored instructions" })).toBeTruthy();
    const urls = request.mock.calls.map(([input]) => {
      if (!(input instanceof URL)) throw new Error("Expected a pinned registry URL");
      return input;
    });
    expect(urls.map((u) => u.pathname)).toEqual([
      "/api/v1/skills/release-search/verify",
      "/api/v1/skills/release-search/file",
    ]);
    for (const url of urls) {
      expect(url.searchParams.get("ownerHandle")).toBe("maker");
      expect(url.searchParams.get("version")).toBe("1.2.3");
    }
    expect(urls[1].searchParams.get("path")).toBe("SKILL.md");
    expect(urls[1].searchParams.get("preview")).toBe("1");
  });

  it.each([
    { publisherHandle: "other" },
    { slug: "alias-target" },
    { version: "9.0.0" },
    { resolvedFrom: "latest" },
  ])("never reads a release file for mismatched registry identity: %o", async (overrides) => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ ...skillMetadata, ...overrides }));
    renderTemplate();
    fireEvent.click(screen.getByRole("button", { name: "@maker/release-search" }));
    expect(await screen.findByText("Skill preview is unavailable for this release.")).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    [404, "Missing version"],
    [403, "Blocked"],
    [200, "# Another publisher's instructions"],
  ] as const)(
    "never substitutes other bytes after a pinned file response (%s)",
    async (status, text) => {
      const request = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(Response.json(skillMetadata))
        .mockResolvedValueOnce(new Response(text, { status }));
      renderTemplate();
      fireEvent.click(screen.getByRole("button", { name: "@maker/release-search" }));
      expect(
        await screen.findByText("Skill preview is unavailable for this release."),
      ).toBeTruthy();
      expect(request).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByRole("heading", { name: "Another publisher's instructions" }),
      ).toBeNull();
    },
  );

  it("does not guess a publisher for an unqualified skill dependency", async () => {
    const request = vi.spyOn(globalThis, "fetch");
    renderTemplate({
      contents: templateContents.replace("@maker/release-search", "release-search"),
    });
    fireEvent.click(screen.getByRole("button", { name: "release-search" }));
    expect(await screen.findByText("Skill preview is unavailable for this release.")).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });

  it("opens the corresponding release metadata for each row in the Plugins section", () => {
    const workspacePath = ".openclaw/extensions/alerts/openclaw.plugin.json";
    renderTemplate({
      contents:
        "---\n" +
        JSON.stringify({
          ...manifest,
          plugins: [...manifest.plugins, { path: "plugins/handoff" }],
          workspace: { files: [{ source: "workspace/alerts.json", path: workspacePath }] },
          mcpServers: {
            filings: {
              url: "https://example.test/mcp",
              transport: "streamable-http",
              auth: "oauth",
            },
          },
        }) +
        "\n---\n# Release instructions",
    });
    const plugins = within(screen.getByRole("region", { name: "Plugins" }));
    for (const [name, metadata] of [
      ["@maker/release-alerts", "2.0.0"],
      ["plugins/handoff", "Bundled · plugins/handoff"],
      ["alerts", "Workspace file · " + workspacePath],
      ["filings", "MCP server"],
    ] as const) {
      fireEvent.click(plugins.getByRole("button", { name: (label) => label.startsWith(name) }));
      const dialog = screen.getByRole("dialog", { name });
      expect(dialog.textContent).toContain(metadata);
      fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog")).toBeNull();
    }
  });

  it("shows the declared schedule and instructions on the named automation", () => {
    renderTemplate();
    const automation = within(screen.getByRole("region", { name: "Automations" }));
    const trigger = automation.getByRole("button", { name: /^Weekday release brief/ });
    expect(automation.queryByText("Summarize the approved release sources.")).toBeNull();
    fireEvent.click(trigger);
    const job = screen.getByRole("dialog", { name: "Weekday release brief" });
    expect(job.textContent).toContain("Weekdays at 9:00 AM · America/Los_Angeles · Disabled");
    expect(job.textContent).toContain("Declared schedule: 0 9 * * 1-5 · America/Los_Angeles");
    expect(job.textContent).toContain("Summarize the approved release sources.");
    const close = within(job).getByRole("button", { name: "Close" });
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lists workspace skills, plugins and heartbeat work without exposing support files", () => {
    renderTemplate({
      contents:
        "---\n" +
        JSON.stringify({
          ...manifest,
          agent: { ...manifest.agent, heartbeat: { every: "1h" } },
          workspace: {
            bootstrapFiles: { "HEARTBEAT.md": { source: "workspace/HEARTBEAT.md" } },
            files: [
              {
                source: "workspace/skills/food-diary/SKILL.md",
                path: "skills/food-diary/SKILL.md",
              },
              { source: "workspace/review.md", path: ".agents/skills/team/review/SKILL.md" },
              // OpenClaw does not descend below an identified skill directory.
              {
                source: "workspace/skills/food-diary/examples/demo/SKILL.md",
                path: "skills/food-diary/examples/demo/SKILL.md",
              },
              {
                source: "workspace/alerts.json",
                path: ".openclaw/extensions/alerts/openclaw.plugin.json",
              },
              // Guides and lookalike paths are ordinary files, not installed capabilities.
              { source: "workspace/reference/automations.md", path: "reference/automations.md" },
              { source: "workspace/reference/SKILL.md", path: "reference/skills/notes/SKILL.md" },
              { source: "workspace/skills/README.md", path: "skills/README.md" },
            ],
          },
        }) +
        "\n---\n# Release instructions",
    });
    const buttons = (region: string) =>
      within(screen.getByRole("region", { name: region }))
        .getAllByRole("button")
        .map((button) => button.textContent);
    expect(buttons("Skills")).toEqual(["@maker/release-search", "food-diary", "review"]);
    expect(buttons("Plugins")).toEqual(["@maker/release-alerts", "alerts"]);
    const jobs = screen.getByRole("region", { name: "Automations" });
    expect(jobs.textContent).toContain("Heartbeat checklistEvery 1h");
    expect(screen.queryByRole("button", { name: "reference/automations.md" })).toBeNull();
  });

  it("shows workspace-file skills for a Template without declared dependencies", () => {
    const detail = packageDetail();
    detail.package!.templateInventory = [];
    render(
      <TemplateDetailPage
        detail={detail}
        contents={
          "---\n" +
          JSON.stringify({
            schemaVersion: 1,
            agent: { id: "myfitnessclaw" },
            workspace: {
              files: [
                {
                  source: "workspace/skills/food-diary/SKILL.md",
                  path: "skills/food-diary/SKILL.md",
                },
                { source: "workspace/reference/automations.md", path: "reference/automations.md" },
              ],
            },
          }) +
          "\n---\n# MyFitnessClaw"
        }
        fallbackOwner="maker"
      />,
    );
    expect(
      within(screen.getByRole("region", { name: "Skills" })).getByRole("button", {
        name: "food-diary",
      }),
    ).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Plugins" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Automations" })).toBeNull();
  });

  it("prefixes an unscoped package with its publisher, like a skill install", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderTemplate({ name: "release-brief" });
    fireEvent.click(screen.getByRole("button", { name: "Copy template install command" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("openclaw templates add @maker/release-brief"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Desktop" }));
    expect(screen.getByRole("link", { name: "Install in OpenClaw" }).getAttribute("href")).toBe(
      "openclaw://templates/install?name=%40maker%2Frelease-brief",
    );
  });

  it("words the prompt for an unscoped package with its publisher", () => {
    // The prompt tab only remains when the Desktop action is unavailable.
    renderTemplate({ name: "release-brief", version: null });
    fireEvent.click(screen.getByRole("button", { name: "Prompt" }));
    expect(screen.getByText("Install the @maker/release-brief template from ClawHub")).toBeTruthy();
  });

  it("copies the real package install command and reports success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderTemplate();
    const button = screen.getByRole("button", { name: "Copy template install command" });
    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute("data-copy-state")).toBe("copied"));
    expect(writeText).toHaveBeenCalledWith("openclaw templates add @maker/release-brief");
    expect(document.querySelector(".skill-install-command-target")?.textContent).toBe(
      " @maker/release-brief",
    );
    expect(document.querySelector(".skill-install-command-verb")?.textContent).toBe(
      "openclaw templates add",
    );
    fireEvent.click(screen.getByRole("button", { name: "Desktop" }));
    expect(screen.getByRole("button", { name: "Desktop" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("link", { name: "Install in OpenClaw" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy template install command" })).toBeNull();
  });

  it.each([
    [
      "retired fields",
      '---\n{"schemaVersion":1,"agent":{"id":"historical"},"packages":[]}\n---\n# Published instructions',
    ],
    ["malformed YAML", "---\nagent: [\n---\n# Published instructions"],
    ["missing document", null],
  ])("blocks both install-copy actions and explains how to repair %s", (_label, contents) => {
    renderTemplate({ contents });
    const warning = screen.getByRole("status");
    expect(screen.queryByRole("button", { name: /Browse release files|SOUL\.md/ })).toBeNull();
    expect(warning.textContent).toContain("cannot be added");
    expect(warning.textContent).toContain("publish a new version");
    expect(
      screen.getByRole("link", { name: "Template migration guide" }).getAttribute("href"),
    ).toBe("/docs/templates");
    expect(
      screen.getByRole("link", { name: "Download release archive" }).getAttribute("href"),
    ).toBe("/api/v1/packages/%40maker%2Frelease-brief/versions/0.1.0/artifact/download");
    expect(screen.queryByRole("button", { name: "Copy template install command" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Install in OpenClaw" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Prompt" }));
    expect(screen.queryByRole("button", { name: "Copy OpenClaw prompt" })).toBeNull();
    if (contents !== null) {
      const original = screen.getByText("View original CLAW.md").closest("details");
      expect(original?.querySelector("code")?.textContent).toBe(contents);
    } else {
      expect(screen.queryByText("View original CLAW.md")).toBeNull();
      expect(warning.textContent).toContain("Reload this page");
    }
  });

  it("uses the stored profile count to block a retired sidecar even when CLAW.md parses", () => {
    const contents =
      '---\n{"schemaVersion":1,"agent":{"id":"historical"}}\n---\n# Original instructions';
    expect(parseTemplateDocument(contents).manifest).not.toBeNull();
    renderTemplate({
      contents,
      manifestSummary: {
        ...packageDetail().package!.templateManifestSummary!,
        profiles: { count: 1, hasOpenClaw: true },
      },
    });
    expect(screen.getByRole("status").textContent).toContain("retired Template profiles");
    expect(screen.queryByRole("button", { name: "Copy template install command" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Install in OpenClaw" })).toBeNull();
    expect(screen.getByText("View original CLAW.md").closest("details")?.textContent).toContain(
      contents,
    );
  });

  it("shows an unsupported original document as escaped text without executing its markup", () => {
    const contents =
      '---\n{"schemaVersion":1,"agent":{"id":"historical"},"packages":[]}\n---\n<script>alert("archive")</script>';
    renderTemplate({ contents });
    const original = screen.getByText("View original CLAW.md").closest("details");
    expect(original?.querySelector("code")?.textContent).toBe(contents);
    expect(original?.querySelector("script")).toBeNull();
  });

  it("truthfully reports clipboard failure", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) },
    });
    renderTemplate();
    const button = screen.getByRole("button", { name: "Copy template install command" });
    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute("data-copy-state")).toBe("failed"));
  });

  it.each([
    ["pending", "pending", "Pending", "0"],
    ["not-run", "pending", "Pending", "0"],
    ["suspicious", "suspicious", "Review", "2"],
    ["malicious", "malicious", "Malicious", "1"],
    [undefined, "pending", "Pending", "0"],
  ] as const)(
    "keeps %s security in the sidebar and gates copy without inline subtext",
    (status, auditStatus, label, level) => {
      const summary = "Release audit details remain available.";
      renderTemplate({ status, llmAnalysis: { status: auditStatus, checkedAt: 1, summary } });
      const metadata = screen.getByRole("complementary");
      const install = within(metadata).getByRole("region", { name: "Install Template" });
      expect(within(install).queryByRole("button", { name: "Desktop" })).toBeNull();
      expect(screen.queryByRole("button", { name: /^(Add|Install)$/i })).toBeNull();
      expect(install.querySelector("p")).toBeNull();
      expect(install.querySelector(".template-detail-install-warning")).toBeNull();
      expect(within(install).queryByRole("alert")).toBeNull();
      expect(within(install).queryByRole("status")).toBeNull();
      expect(within(metadata).getByText("Security audit")).toBeTruthy();
      expect(within(metadata).getByText(summary)).toBeTruthy();
      const link = within(metadata).getByRole("link", {
        name: new RegExp("View Security Audit.*" + label, "i"),
      });
      expect(within(link).getByText(label)).toBeTruthy();
      expect(link.closest("[title]")?.getAttribute("title")).toBe(summary);
      expect(document.getElementById(link.getAttribute("aria-describedby")!)?.textContent).toBe(
        summary,
      );
      expect(link.querySelector(".security-audit-meter")?.getAttribute("data-level")).toBe(level);
      expect(screen.queryByRole("button", { name: "Copy template install command" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Install in OpenClaw" })).toBeNull();
      expect(document.querySelector(".skill-install-command")?.textContent).toBe(
        "openclaw templates add @maker/release-brief",
      );
      fireEvent.click(screen.getByRole("button", { name: "Prompt" }));
      expect(screen.queryByRole("button", { name: "Copy OpenClaw prompt" })).toBeNull();
    },
  );

  it("does not offer install copy for a clean package without a release", () => {
    renderTemplate({ version: null });
    expect(screen.getByText("Not available")).toBeTruthy();
    expect(screen.queryByText(/no current release/)).toBeNull();
    expect(screen.getByRole("region", { name: "Install Template" }).querySelector("p")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy template install command" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Install in OpenClaw" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Prompt" }));
    expect(screen.queryByRole("button", { name: "Copy OpenClaw prompt" })).toBeNull();
  });

  it("previews the implicit SOUL.md from a body-only Template without fetching an archive file", () => {
    renderTemplate({
      contents:
        "---\n" +
        JSON.stringify({ schemaVersion: 1, agent: { id: "release-brief" } }) +
        "\n---\n# Managed instructions\n\nUse the published release notes.",
    });
    fireEvent.click(screen.getByRole("button", { name: "SOUL.md" }));
    const preview = screen.getByRole("dialog", { name: "SOUL.md" });
    expect(within(preview).getByRole("heading", { name: "Managed instructions" })).toBeTruthy();
    expect(within(preview).getByText("Use the published release notes.")).toBeTruthy();
    expect(mocks.fetchPackageFile).not.toHaveBeenCalled();
  });

  it("keeps the direct SOUL.md dialog limited to personality, with no release file browser", () => {
    renderTemplate();
    fireEvent.click(screen.getByRole("button", { name: "SOUL.md" }));
    const preview = within(screen.getByRole("dialog", { name: "SOUL.md" }));
    expect(preview.getByRole("heading", { name: "Release instructions" })).toBeTruthy();
    expect(preview.queryByRole("button", { name: "Browse release files" })).toBeNull();
    expect(preview.queryByRole("tablist")).toBeNull();
  });

  it("keeps explicit SOUL.md archive previews when the document body is empty", async () => {
    renderTemplate({
      contents:
        "---\n" +
        JSON.stringify({
          schemaVersion: 1,
          agent: { id: "release-brief" },
          workspace: { bootstrapFiles: { "SOUL.md": { source: "workspace/SOUL.md" } } },
        }) +
        "\n---\n   \n",
    });
    fireEvent.click(await screen.findByRole("button", { name: "SOUL.md" }));
    expect(await screen.findByRole("heading", { name: "Workspace instructions" })).toBeTruthy();
    expect(mocks.fetchPackageFile).toHaveBeenCalledWith(
      "@maker/release-brief",
      "workspace/SOUL.md",
      "0.1.0",
    );
  });

  it.each([null, "   "])(
    "does not replace unavailable explicit SOUL.md with the manifest or a file browser (%s)",
    async (soul) => {
      mocks.fetchPackageFile.mockResolvedValue(soul);
      const withSoul = {
        ...manifest,
        workspace: { bootstrapFiles: { "SOUL.md": { source: "workspace/SOUL.md" } } },
      };
      await act(async () => {
        renderTemplate({
          contents: "---\n" + JSON.stringify(withSoul) + "\n---\n# Not the explicit SOUL",
        });
      });
      expect(mocks.fetchPackageFile).toHaveBeenCalledWith(
        "@maker/release-brief",
        "workspace/SOUL.md",
        "0.1.0",
      );
      expect(screen.queryByRole("region", { name: "Personality" })).toBeNull();
      expect(screen.queryByRole("button", { name: /Browse release files|SOUL\.md/ })).toBeNull();
      expect(screen.getByRole("button", { name: "@maker/release-search" })).toBeTruthy();
    },
  );

  it("has no personality or file browser when a valid Template has no SOUL.md", () => {
    renderTemplate({ contents: "---\n" + JSON.stringify(manifest) + "\n---\n   " });
    expect(screen.queryByRole("region", { name: "Personality" })).toBeNull();
    expect(screen.queryByRole("button", { name: "SOUL.md" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Browse release files" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Release files" })).toBeNull();
    expect(screen.getByRole("button", { name: "@maker/release-search" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy template install command" })).toBeTruthy();
    expect(mocks.fetchPackageFile).not.toHaveBeenCalled();
  });
});

describe("Template document handling", () => {
  it.each(["automations"])("reads published %s as canonical automations", (key) => {
    const { automations, ...portable } = manifest;
    const parsed = parseTemplateDocument(
      `---\n${JSON.stringify({ ...portable, [key]: automations })}\n---\n# Instructions`,
    );
    expect(parsed.manifest?.automations).toEqual(automations);
    expect(parsed.manifest).not.toHaveProperty("cronJobs");
  });

  it("keeps instructions readable when conflicting automation keys invalidate the manifest", () => {
    expect(
      parseTemplateDocument(
        `---\n${JSON.stringify({ ...manifest, cronJobs: [] })}\n---\n# Instructions`,
      ),
    ).toEqual({
      markdown: "# Instructions",
      manifest: null,
    });
  });

  it("strips BOM and CRLF frontmatter while retaining the published Markdown", () => {
    const parsed = parseTemplateDocument("\uFEFF" + templateContents.replace(/\n/g, "\r\n"));
    expect(parsed.manifest?.skills).toHaveLength(1);
    expect(parsed.manifest?.plugins).toHaveLength(1);
    expect(parsed.markdown).toContain("# Release instructions");
    expect(parsed.markdown).not.toContain("schemaVersion");
  });

  it("does not invent dependencies from malformed or aliased YAML", () => {
    expect(parseTemplateDocument("---\nagent: [\n---\n# Readable body")).toEqual({
      manifest: null,
      markdown: "# Readable body",
    });
    expect(
      parseTemplateDocument(
        "---\nschemaVersion: 1\nagent: &agent {id: test}\nmetadata: *agent\n---\n# Body",
      ).manifest,
    ).toBeNull();
  });

  it.each([
    null,
    "not json",
    '{"openclaw":{"template":"../CLAW.md"}}',
    '{"openclaw":{"template":"/CLAW.md"}}',
  ])("falls back safely from invalid package metadata: %s", (value) => {
    expect(getTemplateManifestPath(value)).toBe("CLAW.md");
  });
});
