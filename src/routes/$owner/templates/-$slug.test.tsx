import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmAnalysis } from "../../../components/SkillSecurityScanResults";
import { TemplateDetailPage } from "../../../components/TemplateDetailPage";
import type { PackageDetailResponse } from "../../../lib/packageApi";
import { getTemplateManifestPath, parseTemplateDocument } from "../../../lib/templateDetail";

const mocks = vi.hoisted(() => ({
  fetchPackageDetail: vi.fn(),
  fetchPackageFile: vi.fn(),
  fetchPackageVersion: vi.fn(),
}));

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

describe("publisher Template detail route loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchPackageVersion.mockResolvedValue(null);
    mocks.fetchPackageFile.mockResolvedValue("# Release Brief");
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
    expect(mocks.fetchPackageDetail).toHaveBeenCalledWith("@maker/release-brief");
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
      ["@maker/release-brief"],
      ["release-brief"],
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

// Computed style declarations are read-only, and jsdom 31 enforces that, so
// layer the line-height override over the real declaration instead of assigning.
function mockComputedLineHeight(lineHeight: string) {
  const getStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((...args) => {
    const style = getStyle(...args);
    return new Proxy(style, {
      get(target, property) {
        if (property === "lineHeight") return lineHeight;
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });
}

function renderTemplate(
  options: {
    status?: NonNullable<PackageDetailResponse["package"]>["scanStatus"];
    contents?: string | null;
    version?: string | null;
    llmAnalysis?: LlmAnalysis | null;
    manifestSummary?: NonNullable<PackageDetailResponse["package"]>["templateManifestSummary"];
  } = {},
) {
  const detail = packageDetail();
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

  it("clamps overflowing descriptions and links the expand/collapse button to the full text", () => {
    mockComputedLineHeight("20px");
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(100);
    renderTemplate();
    const button = screen.getByRole("button", { name: "Read more" });
    const description = document.getElementById(button.getAttribute("aria-controls")!);
    expect(description?.textContent).toBe("Summarizes releases for a new user.");
    expect(description?.getAttribute("data-expanded")).toBe("false");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(description?.getAttribute("data-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    fireEvent.click(button);
    expect(description?.getAttribute("data-expanded")).toBe("false");
  });

  it("does not show an expand button when the description fits within two lines", () => {
    mockComputedLineHeight("20px");
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(40);
    renderTemplate();
    expect(screen.queryByRole("button", { name: "Read more" })).toBeNull();
  });

  it("rechecks description overflow on resize and disconnects on unmount", () => {
    let resize = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    mockComputedLineHeight("20px");
    const height = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(40);
    const view = renderTemplate();
    expect(screen.queryByRole("button", { name: "Read more" })).toBeNull();
    height.mockReturnValue(60);
    act(() => resize());
    expect(screen.getByRole("button", { name: "Read more" })).toBeTruthy();
    height.mockReturnValue(40);
    act(() => resize());
    expect(screen.queryByRole("button", { name: "Read more" })).toBeNull();
    view.unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it("shows Unavailable and neutral bars when a clean package has no release audit evidence", () => {
    renderTemplate();
    const metadata = screen.getByRole("complementary", { name: "Template metadata" });
    expect(within(metadata).getByText("Unavailable")).toBeTruthy();
    expect(within(metadata).queryByText("Clean")).toBeNull();
    expect(metadata.querySelector(".security-audit-meter")?.getAttribute("data-level")).toBe("0");
  });

  it.each([
    ["benign", "Pass", "3"],
    ["suspicious", "Review", "2"],
    ["malicious", "Malicious", "1"],
    ["pending", "Pending", "0"],
    ["error", "Error", "0"],
  ])(
    "uses actual release evidence for %s instead of the package's clean flag",
    (verdict, label, level) => {
      renderTemplate({ llmAnalysis: { status: verdict, verdict, checkedAt: 1 } });
      const metadata = screen.getByRole("complementary", { name: "Template metadata" });
      expect(within(metadata).getByText(label)).toBeTruthy();
      expect(metadata.querySelector(".security-audit-meter")?.getAttribute("data-level")).toBe(
        level,
      );
    },
  );

  it("defaults to rendered CLAW.md without exposing the manifest or old instructional UI", () => {
    renderTemplate();
    expect(screen.getByRole("tab", { name: "CLAW.md" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "Release instructions" })).toBeTruthy();
    expect(screen.getByText("Engineering")).toBeTruthy();
    expect(screen.getByText("Maker")).toBeTruthy();
    expect(screen.getByText("@maker")).toBeTruthy();
    expect(screen.queryByText(/schemaVersion/)).toBeNull();
    expect(screen.queryByText("Add this Template")).toBeNull();
    expect(screen.queryByText("About this Template")).toBeNull();
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.getByText("Nov 5, 2026")).toBeTruthy();
    expect(screen.getByText("v0.1.0")).toBeTruthy();
    expect(screen.queryByText("Declared contents")).toBeNull();
    expect(screen.queryByText(/SHA-256/)).toBeNull();
    expect(screen.getByRole("link", { name: "View Security Audit" }).getAttribute("href")).toBe(
      "/maker/templates/release-brief/security-audit?version=0.1.0",
    );
  });

  it("renders actual pinned package dependencies and automation configuration", () => {
    renderTemplate();
    fireEvent.click(screen.getByRole("tab", { name: "Skills" }));
    expect(screen.getByText("@maker/release-search")).toBeTruthy();
    expect(screen.getByText("Version 1.2.3 · ClawHub")).toBeTruthy();
    expect(screen.getByText("1 declared skill")).toBeTruthy();
    expect(screen.queryByText("@maker/release-alerts")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Plugins" }));
    expect(screen.getByText("@maker/release-alerts")).toBeTruthy();
    expect(screen.getByText("Version 2.0.0 · ClawHub")).toBeTruthy();
    expect(screen.getByText("1 declared plugin")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Automations" }));
    expect(screen.getByText("Weekday release brief")).toBeTruthy();
    expect(screen.getByText("0 9 * * 1-5")).toBeTruthy();
    expect(screen.getByText(/America\/Los_Angeles/)).toBeTruthy();
    expect(screen.getByText(/Paused/)).toBeTruthy();
    expect(screen.getByText("Summarize the approved release sources.")).toBeTruthy();
  });

  it("shows bundled metadata names and paths without fabricated registry versions", () => {
    const detail = packageDetail();
    detail.package!.templateInventory = [
      { kind: "skill", source: "bundled", path: "skills/research", name: "Bundled Research" },
      { kind: "plugin", source: "bundled", path: "plugins/alerts" },
    ];
    render(
      <TemplateDetailPage detail={detail} contents={templateContents} fallbackOwner="maker" />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Skills" }));
    expect(screen.getByText("Bundled Research")).toBeTruthy();
    expect(screen.getByText("skills/research")).toBeTruthy();
    expect(screen.queryByText(/Version/)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Plugins" }));
    expect(screen.getAllByText("plugins/alerts")).toHaveLength(2);
    expect(screen.queryByText(/ClawHub/)).toBeNull();
  });

  it("supports roving focus, wrapping arrow keys, Home and End with linked panels", () => {
    renderTemplate();
    const claw = screen.getByRole("tab", { name: "CLAW.md" });
    fireEvent.keyDown(claw, { key: "ArrowRight" });
    const skills = screen.getByRole("tab", { name: "Skills" });
    expect(document.activeElement).toBe(skills);
    expect(skills.tabIndex).toBe(0);
    expect(claw.tabIndex).toBe(-1);
    expect(screen.getByRole("tabpanel").id).toBe(skills.getAttribute("aria-controls"));
    fireEvent.keyDown(skills, { key: "End" });
    const workspace = screen.getByRole("tab", { name: "Workspace files" });
    expect(document.activeElement).toBe(workspace);
    fireEvent.keyDown(workspace, { key: "ArrowRight" });
    expect(document.activeElement).toBe(claw);
    fireEvent.keyDown(claw, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(workspace);
    fireEvent.keyDown(workspace, { key: "Home" });
    expect(document.activeElement).toBe(claw);
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
    fireEvent.click(screen.getByRole("button", { name: "Prompt" }));
    expect(screen.getByRole("button", { name: "Prompt" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByText("Install the @maker/release-brief template from ClawHub")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy OpenClaw prompt" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith(
        "Install the @maker/release-brief template from ClawHub",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "CLI" }));
    expect(screen.getByRole("button", { name: "Copy template install command" })).toBeTruthy();
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
    expect(warning.textContent).toContain("cannot be added");
    expect(warning.textContent).toContain("publish a new version");
    expect(
      screen.getByRole("link", { name: "Template migration guide" }).getAttribute("href"),
    ).toBe("/docs/templates");
    expect(
      screen.getByRole("link", { name: "Download release archive" }).getAttribute("href"),
    ).toBe("/api/v1/packages/%40maker%2Frelease-brief/versions/0.1.0/artifact/download");
    expect(screen.queryByRole("button", { name: "Copy template install command" })).toBeNull();
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
      const install = screen.getByRole("region", { name: "Install Template" });
      expect(install.querySelector("p")).toBeNull();
      expect(install.querySelector(".template-detail-install-warning")).toBeNull();
      expect(within(install).queryByRole("alert")).toBeNull();
      expect(within(install).queryByRole("status")).toBeNull();
      const metadata = screen.getByRole("complementary", { name: "Template metadata" });
      expect(within(metadata).getByText("Security audit")).toBeTruthy();
      expect(within(metadata).getByText(label)).toBeTruthy();
      expect(within(metadata).getByText(summary)).toBeTruthy();
      const link = within(metadata).getByRole("link", { name: "View Security Audit" });
      expect(link.getAttribute("title")).toBe(summary);
      expect(document.getElementById(link.getAttribute("aria-describedby")!)?.textContent).toBe(
        summary,
      );
      expect(metadata.querySelector(".security-audit-meter")?.getAttribute("data-level")).toBe(
        level,
      );
      expect(screen.queryByRole("button", { name: "Copy template install command" })).toBeNull();
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
    fireEvent.click(screen.getByRole("tab", { name: "Workspace files" }));
    expect(screen.queryByText("No workspace files are included in this Template.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "SOUL.md" }));
    const preview = screen.getByRole("region", { name: "Preview of SOUL.md" });
    expect(within(preview).getByRole("heading", { name: "Managed instructions" })).toBeTruthy();
    expect(within(preview).getByText("Use the published release notes.")).toBeTruthy();
    expect(mocks.fetchPackageFile).not.toHaveBeenCalled();
  });

  it("opens the selected file beside its filename and moves focus to its preview", async () => {
    renderTemplate();
    fireEvent.click(screen.getByRole("tab", { name: "Workspace files" }));
    for (const name of ["SOUL.md", "AGENTS.md"]) {
      const file = screen.getByRole("button", { name });
      fireEvent.click(file);
      const preview = within(file.closest("li")!).getByRole("region", { name: /Preview of/ });
      expect(document.activeElement).toBe(preview);
      expect(file.getAttribute("aria-expanded")).toBe("true");
      expect(file.getAttribute("aria-controls")).toBe(preview.id);
    }
    expect(await screen.findByRole("heading", { name: "Workspace instructions" })).toBeTruthy();
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
    fireEvent.click(screen.getByRole("tab", { name: "Workspace files" }));
    expect(screen.getAllByRole("button", { name: "SOUL.md" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "SOUL.md" }));
    expect(await screen.findByRole("heading", { name: "Workspace instructions" })).toBeTruthy();
    expect(mocks.fetchPackageFile).toHaveBeenCalledWith(
      "@maker/release-brief",
      "workspace/SOUL.md",
      "0.1.0",
    );
  });

  it("reads real workspace source files only after selection and pins their version", async () => {
    renderTemplate();
    expect(mocks.fetchPackageFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Workspace files" }));
    fireEvent.click(screen.getByRole("button", { name: "AGENTS.md" }));
    expect(await screen.findByRole("heading", { name: "Workspace instructions" })).toBeTruthy();
    expect(mocks.fetchPackageFile).toHaveBeenCalledWith(
      "@maker/release-brief",
      "workspace/AGENTS.md",
      "0.1.0",
    );
    mocks.fetchPackageFile.mockResolvedValueOnce("Checklist from the archive.");
    fireEvent.click(screen.getByRole("button", { name: "notes/checklist.txt" }));
    expect(await screen.findByText("Checklist from the archive.")).toBeTruthy();
  });

  it("keeps file failures and unavailable previews distinct and supports retry", async () => {
    mocks.fetchPackageFile
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce(null);
    renderTemplate();
    fireEvent.click(screen.getByRole("tab", { name: "Workspace files" }));
    fireEvent.click(screen.getByRole("button", { name: "AGENTS.md" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("File preview is unavailable for this release.")).toBeTruthy();
  });

  it("does not let a stale file response overwrite the current selection", async () => {
    let resolveFirst!: (contents: string) => void;
    mocks.fetchPackageFile
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce("Current checklist");
    renderTemplate();
    fireEvent.click(screen.getByRole("tab", { name: "Workspace files" }));
    fireEvent.click(screen.getByRole("button", { name: "AGENTS.md" }));
    expect(screen.getByRole("status").textContent).toBe("Loading file…");
    fireEvent.click(screen.getByRole("button", { name: "notes/checklist.txt" }));
    expect(await screen.findByText("Current checklist")).toBeTruthy();
    await act(async () => resolveFirst("# Stale workspace instructions"));
    expect(screen.queryByText("Stale workspace instructions")).toBeNull();
  });

  it("distinguishes unavailable manifests from valid empty sections", () => {
    const { unmount } = renderTemplate({ contents: null });
    expect(screen.getByText(/Template instructions are unavailable/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Skills" }));
    expect(screen.getByText(/manifest is unavailable/)).toBeTruthy();
    unmount();
    renderTemplate({
      contents:
        "---\n" +
        JSON.stringify({ schemaVersion: 1, agent: { id: "empty" } }) +
        "\n---\n# Empty template",
    });
    fireEvent.click(screen.getByRole("tab", { name: "Skills" }));
    expect(
      within(screen.getByRole("tabpanel")).getByText("No skills are included in this Template."),
    ).toBeTruthy();
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
