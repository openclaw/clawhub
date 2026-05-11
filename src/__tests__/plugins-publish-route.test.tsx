/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DocsLinks } from "clawhub-schema";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => (config: { component: unknown }) => ({
    __config: config,
    __path: path,
  }),
  useSearch: () => ({
    ownerHandle: undefined,
    name: undefined,
    displayName: undefined,
    family: undefined,
    nextVersion: undefined,
    sourceRepo: undefined,
  }),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: vi.fn() }),
}));

const generateUploadUrl = vi.fn();
const publishRelease = vi.fn();
const fetchMock = vi.fn();
const useAuthStatusMock = vi.fn();
const useQueryMock = vi.fn();
const originalFetch = globalThis.fetch;

vi.mock("convex/react", () => ({
  ConvexReactClient: class {},
  useMutation: () => generateUploadUrl,
  useAction: () => publishRelease,
  useQuery: () => useQueryMock(),
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => useAuthStatusMock(),
}));

import { PublishPluginRoute, Route } from "../routes/plugins/publish";

function renderPublishRoute() {
  render(createElement(PublishPluginRoute as never));
}

function withRelativePath(file: File, path: string) {
  Object.defineProperty(file, "webkitRelativePath", {
    value: path,
    configurable: true,
  });
  return file;
}

function makeCodePluginPackageJson(overrides: Record<string, unknown>) {
  return JSON.stringify({
    openclaw: {
      extensions: ["./index.ts"],
      compat: {
        pluginApi: ">=2026.3.24-beta.2",
      },
      build: {
        openclawVersion: "2026.3.24-beta.2",
      },
    },
    ...overrides,
  });
}

function getFileInput() {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("Missing file input");
  return input;
}

function getFileInputs() {
  return Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
}

describe("plugins publish route", () => {
  beforeEach(() => {
    generateUploadUrl.mockReset();
    publishRelease.mockReset();
    fetchMock.mockReset();
    useAuthStatusMock.mockReset();
    useQueryMock.mockReset();

    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:1" },
    });
    useQueryMock.mockReturnValue([
      {
        publisher: {
          _id: "publishers:vintageayu",
          handle: "vintageayu",
          displayName: "VintageAyu",
          kind: "user",
        },
        role: "owner",
      },
    ]);
    generateUploadUrl.mockResolvedValue("https://upload.local");
    publishRelease.mockResolvedValue({ ok: true, packageId: "pkg:1", releaseId: "rel:1" });
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        storageId: `storage:${((init?.body as File | undefined)?.name ?? "unknown").replaceAll("/", "_")}`,
      }),
    }));
    Object.defineProperty(globalThis, "fetch", {
      value: fetchMock,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "fetch", {
      value: originalFetch,
      configurable: true,
      writable: true,
    });
  });

  it("registers the publish form on /plugins/publish", () => {
    expect(Route).toBeTruthy();
  });

  it("requires sign-in before showing the plugin publish form", () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      me: null,
    });

    renderPublishRoute();

    expect(screen.getByText("Sign in to publish a plugin")).toBeTruthy();
    expect(
      screen.getByText("You need to be signed in to publish plugins on ClawHub."),
    ).toBeTruthy();
    expect(screen.queryByText(/Upload plugin code to detect the package shape/i)).toBeNull();
    expect(screen.queryByPlaceholderText("Plugin name")).toBeNull();
  });

  it("keeps metadata inputs locked until plugin code is uploaded", () => {
    renderPublishRoute();

    expect(screen.getByText(/Upload plugin code to detect the package shape/i)).toBeTruthy();
    expect(screen.getByPlaceholderText("Plugin name").getAttribute("disabled")).not.toBeNull();
    expect(screen.getByPlaceholderText("Display name").getAttribute("disabled")).not.toBeNull();
    expect(screen.getByPlaceholderText("Version").getAttribute("disabled")).not.toBeNull();
    expect(screen.getByPlaceholderText("Changelog").getAttribute("disabled")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Publish" }).getAttribute("disabled")).not.toBeNull();
  });

  it("opens only the directory picker when clicking Choose folder", () => {
    renderPublishRoute();

    const [archiveInput, directoryInput] = getFileInputs();
    const archiveClick = vi.fn();
    const directoryClick = vi.fn();
    archiveInput.click = archiveClick;
    directoryInput.click = directoryClick;

    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));

    expect(directoryClick).toHaveBeenCalledTimes(1);
    expect(archiveClick).not.toHaveBeenCalled();
  });

  it("opens only the archive picker when clicking Browse files", () => {
    renderPublishRoute();

    const [archiveInput, directoryInput] = getFileInputs();
    const archiveClick = vi.fn();
    const directoryClick = vi.fn();
    archiveInput.click = archiveClick;
    directoryInput.click = directoryClick;

    fireEvent.click(screen.getByRole("button", { name: "Browse files" }));

    expect(archiveClick).toHaveBeenCalledTimes(1);
    expect(directoryClick).not.toHaveBeenCalled();
  });

  it("publishes a code plugin folder with source metadata and normalized file paths", async () => {
    renderPublishRoute();

    const packageJson = withRelativePath(
      new File(
        [
          makeCodePluginPackageJson({
            name: "demo-plugin",
            displayName: "Demo Plugin",
            version: "1.2.3",
            repository: "https://github.com/openclaw/demo-plugin.git",
          }),
        ],
        "package.json",
        { type: "application/json" },
      ),
      "demo-plugin/package.json",
    );
    const manifest = withRelativePath(
      new File(['{"id":"demo.plugin"}'], "openclaw.plugin.json", { type: "application/json" }),
      "demo-plugin/openclaw.plugin.json",
    );
    const dist = withRelativePath(
      new File(["export const demo = true;\n"], "index.js", { type: "text/javascript" }),
      "demo-plugin/dist/index.js",
    );

    fireEvent.change(getFileInput(), { target: { files: [packageJson, manifest, dist] } });

    await waitFor(() => {
      expect(screen.getByDisplayValue("demo-plugin")).toBeTruthy();
      expect(screen.getByDisplayValue("Demo Plugin")).toBeTruthy();
      expect(screen.getByDisplayValue("1.2.3")).toBeTruthy();
      expect(screen.getByDisplayValue("openclaw/demo-plugin")).toBeTruthy();
      expect(screen.getByPlaceholderText("Plugin name").getAttribute("disabled")).toBeNull();
    });

    fireEvent.change(screen.getByPlaceholderText("Changelog"), {
      target: { value: "Initial release" },
    });
    fireEvent.change(screen.getByPlaceholderText("Source commit"), {
      target: { value: "abc123" },
    });
    fireEvent.change(screen.getByPlaceholderText("Source ref (tag or branch)"), {
      target: { value: "refs/tags/v1.2.3" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => {
      expect(publishRelease).toHaveBeenCalledTimes(1);
    });

    expect(generateUploadUrl).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(publishRelease).toHaveBeenCalledWith({
      payload: expect.objectContaining({
        name: "demo-plugin",
        displayName: "Demo Plugin",
        family: "code-plugin",
        version: "1.2.3",
        changelog: "Initial release",
        source: expect.objectContaining({
          kind: "github",
          repo: "openclaw/demo-plugin",
          url: "https://github.com/openclaw/demo-plugin",
          ref: "refs/tags/v1.2.3",
          commit: "abc123",
          path: ".",
        }),
        files: expect.arrayContaining([
          expect.objectContaining({ path: "package.json" }),
          expect.objectContaining({ path: "openclaw.plugin.json" }),
          expect.objectContaining({ path: "dist/index.js" }),
        ]),
      }),
    });
  });

  it("surfaces missing OpenClaw compatibility metadata before publish", async () => {
    renderPublishRoute();

    const packageJson = withRelativePath(
      new File(
        [
          makeCodePluginPackageJson({
            name: "demo-plugin",
            displayName: "Demo Plugin",
            version: "1.2.3",
            openclaw: {
              extensions: ["./index.ts"],
            },
          }),
        ],
        "package.json",
        { type: "application/json" },
      ),
      "demo-plugin/package.json",
    );
    const manifest = withRelativePath(
      new File(
        [
          JSON.stringify({
            id: "demo.plugin",
            name: "Demo Plugin",
            configSchema: { type: "object", additionalProperties: false },
          }),
        ],
        "openclaw.plugin.json",
        { type: "application/json" },
      ),
      "demo-plugin/openclaw.plugin.json",
    );

    fireEvent.change(getFileInput(), { target: { files: [packageJson, manifest] } });

    await waitFor(() => {
      expect(screen.getByText(/Missing required OpenClaw package metadata:/i)).toBeTruthy();
    });

    expect(screen.getByText(/openclaw\.compat\.pluginApi/i)).toBeTruthy();
    expect(screen.getByText(/openclaw\.build\.openclawVersion/i)).toBeTruthy();
    const docsLink = screen.getByRole("link", { name: /Plugin Setup and Config/i });
    expect(docsLink.getAttribute("href")).toBe(DocsLinks.openclaw.pluginPackageMetadata);
    expect(docsLink.getAttribute("target")).toBe("_blank");
    expect(docsLink.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("button", { name: "Publish" }).getAttribute("disabled")).not.toBeNull();
    expect(publishRelease).not.toHaveBeenCalled();
  });

  it("blocks scoped package names that do not match the selected owner", async () => {
    renderPublishRoute();

    const packageJson = withRelativePath(
      new File(
        [
          makeCodePluginPackageJson({
            name: "@openclaw/dronzer",
            displayName: "Dronzer Controller",
            version: "1.0.0",
            repository: "https://github.com/VintageAyu/dronzerclaw.git",
          }),
        ],
        "package.json",
        { type: "application/json" },
      ),
      "dronzer/package.json",
    );
    const manifest = withRelativePath(
      new File(['{"id":"dronzer"}'], "openclaw.plugin.json", { type: "application/json" }),
      "dronzer/openclaw.plugin.json",
    );

    fireEvent.change(getFileInput(), { target: { files: [packageJson, manifest] } });

    await waitFor(() => {
      expect(screen.getByDisplayValue("@openclaw/dronzer")).toBeTruthy();
      expect(
        screen.getByText(/Package scope "@openclaw" must match selected owner "@vintageayu"/i),
      ).toBeTruthy();
    });

    const docsLink = screen.getByRole("link", { name: /Learn how publishing works/i });
    expect(docsLink.getAttribute("href")).toBe(DocsLinks.clawhub.packageScopeFaq);
    expect(docsLink.getAttribute("target")).toBe("_blank");
    expect(docsLink.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("button", { name: "Publish" }).getAttribute("disabled")).not.toBeNull();
    expect(publishRelease).not.toHaveBeenCalled();
  });

  it("does not mark the upload summary ready while validation errors are present", async () => {
    renderPublishRoute();

    const bigFile = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "too-big.bin", {
      type: "application/octet-stream",
    });

    fireEvent.change(getFileInput(), { target: { files: [bigFile] } });

    await waitFor(() => {
      expect(screen.getByText(/Each file must be 10MB or smaller/i)).toBeTruthy();
    });

    const summaryBorders = document.querySelectorAll(".border-emerald-300\\/40");
    expect(summaryBorders.length).toBe(0);
  });

  it("does not expose the staged bundle plugin publish mode", async () => {
    renderPublishRoute();

    const packageJson = withRelativePath(
      new File(
        [
          makeCodePluginPackageJson({
            name: "demo-bundle",
            displayName: "Demo Bundle",
            version: "0.4.0",
          }),
        ],
        "package.json",
        { type: "application/json" },
      ),
      "demo-bundle/package.json",
    );
    const manifest = withRelativePath(
      new File(['{"id":"demo.bundle"}'], "openclaw.plugin.json", { type: "application/json" }),
      "demo-bundle/openclaw.plugin.json",
    );
    const bundleMarker = withRelativePath(
      new File(['{"name":"Demo Bundle"}'], "plugin.json", { type: "application/json" }),
      "demo-bundle/.codex-plugin/plugin.json",
    );
    const binary = withRelativePath(
      new File([new Uint8Array([1, 2, 3])], "plugin.wasm", { type: "application/wasm" }),
      "demo-bundle/dist/plugin.wasm",
    );

    fireEvent.change(getFileInput(), {
      target: { files: [packageJson, manifest, bundleMarker, binary] },
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("demo-bundle")).toBeTruthy();
      expect(screen.getByDisplayValue("Demo Bundle")).toBeTruthy();
      expect(screen.getByDisplayValue("0.4.0")).toBeTruthy();
      expect(screen.getAllByRole("combobox")[0].textContent).toBe("Code plugin");
      expect(screen.queryByText("Bundle plugin")).toBeNull();
      expect(screen.getByText("Agent metadata")).toBeTruthy();
      expect(screen.queryByPlaceholderText("Bundle format")).toBeNull();
      expect(screen.getByText(/Browse files/i)).toBeTruthy();
      expect(screen.getByText(/Choose folder/i)).toBeTruthy();
    });
    expect(publishRelease).not.toHaveBeenCalled();
  });

  it("prefills metadata from a wrapped GitHub release package", async () => {
    renderPublishRoute();

    const packageJson = new File(
      [
        JSON.stringify({
          name: "@opik/opik-openclaw",
          version: "0.2.9",
          openclaw: {
            compat: {
              pluginApi: ">=2026.3.24-beta.2",
              minGatewayVersion: "2026.3.24-beta.2",
            },
            build: {
              openclawVersion: "2026.3.24-beta.2",
              pluginSdkVersion: "2026.3.24-beta.2",
            },
          },
          repository: {
            type: "git",
            url: "https://github.com/comet-ml/opik-openclaw.git",
          },
        }),
      ],
      "opik-openclaw-0.2.9/package.json",
      { type: "application/json" },
    );
    const manifest = new File(
      [JSON.stringify({ id: "opik-openclaw", name: "Opik" })],
      "opik-openclaw-0.2.9/openclaw.plugin.json",
      { type: "application/json" },
    );
    const readme = new File(["# Opik OpenClaw\n"], "opik-openclaw-0.2.9/README.md", {
      type: "text/markdown",
    });

    fireEvent.change(getFileInput(), { target: { files: [packageJson, manifest, readme] } });

    await waitFor(() => {
      expect(screen.getByDisplayValue("@opik/opik-openclaw")).toBeTruthy();
      expect(screen.getByDisplayValue("Opik")).toBeTruthy();
      expect(screen.getByDisplayValue("0.2.9")).toBeTruthy();
      expect(screen.getByDisplayValue("comet-ml/opik-openclaw")).toBeTruthy();
      expect(screen.getByText(/Metadata detected and prefilled/i)).toBeTruthy();
      expect(
        screen.getByText(
          /Autofilled package type, plugin name, display name, version, source repo, compatibility\./i,
        ),
      ).toBeTruthy();
      expect(screen.getByText("Package manifest")).toBeTruthy();
      expect(screen.getByText("Plugin manifest")).toBeTruthy();
      expect(screen.queryByText("opik-openclaw-0.2.9/package.json")).toBeNull();
    });
  });

  it("applies ignore rules before uploading a plugin folder", async () => {
    renderPublishRoute();

    const packageJson = withRelativePath(
      new File(
        [makeCodePluginPackageJson({ name: "demo-plugin", version: "1.0.0" })],
        "package.json",
        {
          type: "application/json",
        },
      ),
      "demo-plugin/package.json",
    );
    const ignoreFile = withRelativePath(
      new File(["dist/\n"], ".gitignore", { type: "text/plain" }),
      "demo-plugin/.gitignore",
    );
    const manifest = withRelativePath(
      new File(['{"id":"demo.plugin"}'], "openclaw.plugin.json", { type: "application/json" }),
      "demo-plugin/openclaw.plugin.json",
    );
    const kept = withRelativePath(
      new File(["export const demo = true;\n"], "index.js", { type: "text/javascript" }),
      "demo-plugin/src/index.js",
    );
    const ignoredNodeModules = withRelativePath(
      new File(["ignored"], "index.js", { type: "text/javascript" }),
      "demo-plugin/node_modules/dep/index.js",
    );
    const ignoredDist = withRelativePath(
      new File(["ignored"], "index.js", { type: "text/javascript" }),
      "demo-plugin/dist/index.js",
    );

    fireEvent.change(getFileInput(), {
      target: { files: [packageJson, ignoreFile, manifest, kept, ignoredNodeModules, ignoredDist] },
    });

    await waitFor(() => {
      expect(screen.getByText(/Ignored 1 files/i)).toBeTruthy();
    });

    fireEvent.change(screen.getByPlaceholderText("Changelog"), {
      target: { value: "Initial release" },
    });
    fireEvent.change(screen.getByLabelText("ClawScan note"), {
      target: { value: "Native host access is limited to the OpenClaw extension bridge." },
    });
    fireEvent.change(screen.getByPlaceholderText("Source repo (owner/repo)"), {
      target: { value: "openclaw/demo-plugin" },
    });
    fireEvent.change(screen.getByPlaceholderText("Source commit"), {
      target: { value: "abc123" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => {
      expect(publishRelease).toHaveBeenCalledTimes(1);
    });

    expect(generateUploadUrl).toHaveBeenCalledTimes(5);
    const payload = publishRelease.mock.calls[0]?.[0]?.payload as {
      files: Array<{ path: string }>;
      clawScanNote?: string;
    };
    expect(payload.files.map((file) => file.path).sort()).toEqual([
      ".gitignore",
      "dist/index.js",
      "openclaw.plugin.json",
      "package.json",
      "src/index.js",
    ]);
    expect(payload.clawScanNote).toBe(
      "Native host access is limited to the OpenClaw extension bridge.",
    );
  });

  it("blocks plugin publish when a file exceeds 10MB", async () => {
    renderPublishRoute();

    const packageJson = withRelativePath(
      new File(
        [makeCodePluginPackageJson({ name: "demo-plugin", version: "1.0.0" })],
        "package.json",
        {
          type: "application/json",
        },
      ),
      "demo-plugin/package.json",
    );
    const manifest = withRelativePath(
      new File(['{"id":"demo.plugin"}'], "openclaw.plugin.json", { type: "application/json" }),
      "demo-plugin/openclaw.plugin.json",
    );
    const huge = withRelativePath(
      new File(["x"], "plugin.wasm", { type: "application/wasm" }),
      "demo-plugin/dist/plugin.wasm",
    );
    Object.defineProperty(huge, "size", {
      value: 10 * 1024 * 1024 + 1,
      configurable: true,
    });

    fireEvent.change(getFileInput(), { target: { files: [packageJson, manifest, huge] } });

    await waitFor(() => {
      expect(screen.getByText(/Each file must be 10MB or smaller: plugin\.wasm/i)).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Publish" }).getAttribute("disabled")).not.toBeNull();
    expect(publishRelease).not.toHaveBeenCalled();
  });

  it("shows pending verification messaging after plugin publish", async () => {
    renderPublishRoute();

    const packageJson = withRelativePath(
      new File(
        [makeCodePluginPackageJson({ name: "demo-plugin", version: "1.0.0" })],
        "package.json",
        {
          type: "application/json",
        },
      ),
      "demo-plugin/package.json",
    );
    const manifest = withRelativePath(
      new File(['{"id":"demo.plugin"}'], "openclaw.plugin.json", { type: "application/json" }),
      "demo-plugin/openclaw.plugin.json",
    );
    const dist = withRelativePath(
      new File(["export const demo = true;\n"], "index.js", { type: "text/javascript" }),
      "demo-plugin/dist/index.js",
    );

    fireEvent.change(getFileInput(), { target: { files: [packageJson, manifest, dist] } });
    await waitFor(() => {
      expect(screen.getByDisplayValue("demo-plugin")).toBeTruthy();
    });
    fireEvent.change(screen.getByPlaceholderText("Changelog"), {
      target: { value: "Initial release" },
    });
    fireEvent.change(screen.getByPlaceholderText("Source repo (owner/repo)"), {
      target: { value: "openclaw/demo-plugin" },
    });
    fireEvent.change(screen.getByPlaceholderText("Source commit"), {
      target: { value: "abc123" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    expect(
      await screen.findByText(/Pending security checks and verification before public listing\./i),
    ).toBeTruthy();
  });
});
