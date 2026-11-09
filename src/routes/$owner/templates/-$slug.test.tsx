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

vi.mock("../../../lib/packageApi", () => mocks);
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
  packages: [
    { kind: "skill", source: "clawhub", ref: "@maker/release-search", version: "1.2.3" },
    { kind: "plugin", source: "clawhub", ref: "@maker/release-alerts", version: "2.0.0" },
  ],
  automations: [
    {
      id: "weekday-brief",
      name: "Weekday release brief",
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
  } = {},
) {
  const detail = packageDetail();
  detail.package!.scanStatus = options.status ?? "clean";
  detail.package!.updatedAt = Date.UTC(2026, 10, 5);
  if ("version" in options) detail.package!.latestVersion = options.version;
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

  it("shows Unavailable and neutral bars when a clean package has no release audit evidence", () => {
    renderTemplate();
    const metadata = screen.getByRole("complementary", { name: "Template metadata" });
    expect(within(metadata).getByText("Unavailable")).toBeTruthy();
    expect(within(metadata).queryByText("Clean")).toBeNull();
    expect(metadata.querySelector(".security-audit-meter")?.getAttribute("data-level")).toBe("0");
  });

  it.each([
    ["benign", "Clean", "3"],
    ["suspicious", "Review", "2"],
    ["malicious", "Malicious", "1"],
    ["pending", "Unavailable", "0"],
    ["error", "Unavailable", "0"],
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
  });

  it("renders actual pinned package dependencies and automation configuration", () => {
    renderTemplate();
    fireEvent.click(screen.getByRole("tab", { name: "Skills" }));
    expect(screen.getByText("@maker/release-search")).toBeTruthy();
    expect(screen.getByText("Version 1.2.3 · clawhub")).toBeTruthy();
    expect(screen.queryByText("@maker/release-alerts")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Plugins" }));
    expect(screen.getByText("@maker/release-alerts")).toBeTruthy();
    expect(screen.getByText("Version 2.0.0 · clawhub")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Automations" }));
    expect(screen.getByText("Weekday release brief")).toBeTruthy();
    expect(screen.getByText("0 9 * * 1-5")).toBeTruthy();
    expect(screen.getByText(/America\/Los_Angeles/)).toBeTruthy();
    expect(screen.getByText("Summarize the approved release sources.")).toBeTruthy();
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
    ["pending", /Security review pending/],
    ["not-run", /Security review has not started/],
    ["suspicious", /Security scan flagged/],
    ["malicious", /marked this Template as malicious/],
  ] as const)("preserves %s warnings and gates install copy", (status, warning) => {
    renderTemplate({ status });
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.getAllByText(warning).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Copy template install command" })).toBeNull();
    expect(document.querySelector(".skill-install-command")?.textContent).toBe(
      "openclaw templates add @maker/release-brief",
    );
    fireEvent.click(screen.getByRole("button", { name: "Prompt" }));
    expect(screen.queryByRole("button", { name: "Copy OpenClaw prompt" })).toBeNull();
    if (status === "suspicious" || status === "malicious")
      expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("does not offer install copy for a clean package without a release", () => {
    renderTemplate({ version: null });
    expect(screen.getByText("Not available")).toBeTruthy();
    expect(screen.getByText(/no current release/)).toBeTruthy();
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
  it.each(["automations", "cronJobs"])("reads published %s as canonical automations", (key) => {
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
    expect(parsed.manifest?.packages).toHaveLength(2);
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
