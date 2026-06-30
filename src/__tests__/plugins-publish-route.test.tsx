/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DocsLinks } from "clawhub-schema";
import { getFunctionName } from "convex/server";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toastErrorMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => (config: { component: unknown }) => ({
    __config: config,
    __path: path,
  }),
  useSearch: () => useSearchMock(),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
  },
}));

const generateUploadUrl = vi.fn();
const publishRelease = vi.fn();
const fetchMock = vi.fn();
const useAuthStatusMock = vi.fn();
const useQueryMock = vi.fn();
const useSearchMock = vi.fn();
const originalFetch = globalThis.fetch;

vi.mock("convex/react", () => ({
  ConvexReactClient: class {},
  useMutation: () => generateUploadUrl,
  useAction: () => publishRelease,
  useQuery: (...args: unknown[]) => useQueryMock(...args),
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

function selectCategory(name: string) {
  const trigger = screen.getByRole("button", { name: "Categories" });
  if (trigger.getAttribute("aria-expanded") !== "true") {
    fireEvent.pointerDown(trigger, { button: 0 });
  }
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name }));
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
}

describe("plugins publish route", () => {
  beforeEach(() => {
    generateUploadUrl.mockReset();
    publishRelease.mockReset();
    fetchMock.mockReset();
    useAuthStatusMock.mockReset();
    useQueryMock.mockReset();
    useSearchMock.mockReset();
    toastErrorMock.mockReset();

    useSearchMock.mockReturnValue({
      ownerHandle: undefined,
      name: undefined,
      displayName: undefined,
      family: undefined,
      nextVersion: undefined,
      sourceRepo: undefined,
    });
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:1" },
    });
    useQueryMock.mockImplementation((fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      const name = fn ? getFunctionName(fn as Parameters<typeof getFunctionName>[0]) : "";
      if (name !== "publishers:listMine") return null;
      return [
        {
          publisher: {
            _id: "publishers:vintageayu",
            handle: "vintageayu",
            displayName: "VintageAyu",
            kind: "user",
            image: "/clawd-logo.png",
          },
          role: "owner",
        },
      ];
    });
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

  it("links to the plugin publishing guide", () => {
    renderPublishRoute();

    const guideLink = screen.getByRole("link", { name: /Plugin publishing guide/i });
    expect(guideLink.getAttribute("href")).toBe(
      "https://docs.openclaw.ai/clawhub/publishing#plugins",
    );
    expect(guideLink.getAttribute("target")).toBe("_blank");
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
    expect(screen.queryByText(/Upload plugin code first/i)).toBeNull();
    expect(screen.queryByPlaceholderText("Plugin name")).toBeNull();
  });

  it("keeps metadata inputs locked until plugin code is uploaded", () => {
    renderPublishRoute();

    expect(screen.getByText(/Upload plugin code first/i)).toBeTruthy();
    expect(screen.getByPlaceholderText("Plugin name").getAttribute("disabled")).not.toBeNull();
    expect(screen.getByPlaceholderText("Display name").getAttribute("disabled")).not.toBeNull();
    expect(screen.getByPlaceholderText("Version").getAttribute("disabled")).not.toBeNull();
    expect(screen.queryByPlaceholderText("Describe what changed in this release...")).toBeNull();
    expect(screen.getByLabelText("Owner").textContent).toContain("@vintageayu · VintageAyu");
    expect(document.querySelector('img[src="/clawd-logo.png"]')).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Publish plugin" }).getAttribute("disabled"),
    ).not.toBeNull();
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

  it("opens only the archive picker when clicking Choose archive", () => {
    renderPublishRoute();

    const [archiveInput, directoryInput] = getFileInputs();
    const archiveClick = vi.fn();
    const directoryClick = vi.fn();
    archiveInput.click = archiveClick;
    directoryInput.click = directoryClick;

    fireEvent.click(screen.getByRole("button", { name: "Choose archive" }));

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
      expect(screen.getByText(/Complete commit SHA to publish/i)).toBeTruthy();
    });

    fireEvent.change(screen.getByPlaceholderText("Full commit SHA"), {
      target: { value: "abc123" },
    });
    fireEvent.change(screen.getByPlaceholderText("v1.0.0 or main"), {
      target: { value: "refs/tags/v1.2.3" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Publish plugin" }));

    await waitFor(() => {
      expect(publishRelease).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(
        screen.getByText(
          /Published\. Pending security checks and verification before public listing\./i,
        ),
      ).toBeTruthy();
    });

    expect(generateUploadUrl).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(publishRelease).toHaveBeenCalledWith({
      payload: expect.objectContaining({
        name: "demo-plugin",
        displayName: "Demo Plugin",
        family: "code-plugin",
        version: "1.2.3",
        changelog: "",
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

  it("prefills and preserves catalog metadata when publishing a new plugin version", async () => {
    useSearchMock.mockReturnValue({
      ownerHandle: "vintageayu",
      name: "demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin",
      nextVersion: "1.2.4",
      sourceRepo: "openclaw/demo-plugin",
    });
    useQueryMock.mockImplementation((fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      const name = fn ? getFunctionName(fn as Parameters<typeof getFunctionName>[0]) : "";
      if (name === "packages:getManageContext") {
        return {
          package: {
            name: "demo-plugin",
            displayName: "Demo Plugin",
            categories: ["tools"],
            topics: ["GPU development"],
          },
          latestRelease: { version: "1.2.3" },
          suggestedCategories: [],
        };
      }
      if (name === "publishers:listMine") return [];
      return null;
    });

    renderPublishRoute();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Categories" }).textContent).toContain("Tools");
      expect(screen.getByRole("button", { name: "Remove GPU development topic" })).toBeTruthy();
    });

    const packageJson = withRelativePath(
      new File(
        [
          makeCodePluginPackageJson({
            name: "demo-plugin",
            displayName: "Demo Plugin",
            version: "1.2.4",
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
    fireEvent.change(getFileInput(), { target: { files: [packageJson, manifest] } });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Plugin name").getAttribute("disabled")).toBeNull();
    });
    fireEvent.change(screen.getByPlaceholderText("Full commit SHA"), {
      target: { value: "abc123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish plugin" }));

    await waitFor(() => {
      expect(publishRelease).toHaveBeenCalledTimes(1);
    });
    expect(publishRelease).toHaveBeenCalledWith({
      payload: expect.objectContaining({
        categories: ["tools"],
        topics: ["GPU development"],
      }),
    });
  });

  it("sends explicit empty catalog metadata when it is cleared on a plugin version publish", async () => {
    useSearchMock.mockReturnValue({
      ownerHandle: "vintageayu",
      name: "demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin",
      nextVersion: "1.2.4",
      sourceRepo: "openclaw/demo-plugin",
    });
    useQueryMock.mockImplementation((fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      const name = fn ? getFunctionName(fn as Parameters<typeof getFunctionName>[0]) : "";
      if (name === "packages:getManageContext") {
        return {
          package: {
            name: "demo-plugin",
            displayName: "Demo Plugin",
            categories: ["tools"],
            topics: ["GPU development"],
          },
          latestRelease: { version: "1.2.3" },
          suggestedCategories: [],
        };
      }
      if (name === "publishers:listMine") return [];
      return null;
    });

    renderPublishRoute();

    const packageJson = withRelativePath(
      new File(
        [
          makeCodePluginPackageJson({
            name: "demo-plugin",
            displayName: "Demo Plugin",
            version: "1.2.4",
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
    fireEvent.change(getFileInput(), { target: { files: [packageJson, manifest] } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Categories" }).textContent).toContain("Tools");
      expect(screen.getByRole("button", { name: "Remove GPU development topic" })).toBeTruthy();
    });
    selectCategory("Tools");
    fireEvent.click(screen.getByRole("button", { name: "Remove GPU development topic" }));
    fireEvent.change(screen.getByPlaceholderText("Full commit SHA"), {
      target: { value: "abc123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish plugin" }));

    await waitFor(() => {
      expect(publishRelease).toHaveBeenCalledTimes(1);
    });
    expect(publishRelease).toHaveBeenCalledWith({
      payload: expect.objectContaining({
        categories: [],
        topics: [],
      }),
    });
  });

  it("shows backend publish failures inline on the upload form", async () => {
    publishRelease.mockRejectedValueOnce(
      new Error(
        "Plugin Inspector blocked publish: 1 breakage. missing-expected-seam: missing expected registration registerTool",
      ),
    );
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
    });

    fireEvent.change(screen.getByPlaceholderText("Full commit SHA"), {
      target: { value: "abc123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish plugin" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Plugin Inspector blocked publish");
    });
    expect(screen.getByRole("columnheader", { name: "Code" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Message" })).toBeTruthy();
    expect(screen.getByText("missing-expected-seam")).toBeTruthy();
    expect(screen.getByText("missing expected registration registerTool")).toBeTruthy();
    expect(toastErrorMock).not.toHaveBeenCalled();
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
      expect(screen.getByText(/Fix package metadata:/i)).toBeTruthy();
    });

    expect(screen.getByText(/openclaw\.compat\.pluginApi/i)).toBeTruthy();
    expect(screen.getByText(/openclaw\.build\.openclawVersion/i)).toBeTruthy();
    expect(screen.getByText("Missing metadata")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Publish plugin" }).getAttribute("disabled"),
    ).not.toBeNull();
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
        screen.getAllByText(/Package scope "@openclaw" must match selected owner "@vintageayu"/i)
          .length,
      ).toBeGreaterThan(0);
    });

    const docsLink = screen.getByRole("link", { name: /Learn how publishing works/i });
    expect(docsLink.getAttribute("href")).toBe(DocsLinks.clawhub.packageScopeFaq);
    expect(docsLink.getAttribute("target")).toBe("_blank");
    expect(docsLink.getAttribute("rel")).toBe("noopener noreferrer");
    expect(
      screen.getByRole("button", { name: "Publish plugin" }).getAttribute("disabled"),
    ).not.toBeNull();
    expect(publishRelease).not.toHaveBeenCalled();
  });

  it("does not mark the upload summary ready while validation errors are present", async () => {
    renderPublishRoute();

    const bigFile = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "too-big.bin", {
      type: "application/octet-stream",
    });

    fireEvent.change(getFileInput(), { target: { files: [bigFile] } });

    await waitFor(() => {
      expect(screen.getAllByText(/Each file must be 10MB or smaller/i).length).toBeGreaterThan(0);
    });

    const summaryBorders = document.querySelectorAll(".border-emerald-300\\/45");
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
      expect(screen.getByText("Code plugin")).toBeTruthy();
      expect(screen.queryByText("Bundle plugin")).toBeNull();
      expect(screen.getByText("Agent metadata")).toBeTruthy();
      expect(screen.queryByPlaceholderText("Bundle format")).toBeNull();
      expect(screen.getByText(/Replace package/i)).toBeTruthy();
      expect(screen.getByText(/Clear package/i)).toBeTruthy();
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
      expect(screen.getByText(/Package detected/i)).toBeTruthy();
      expect(screen.queryByText(/^Compatibility:/i)).toBeNull();
      expect(screen.queryByText("Compatibility")).toBeNull();
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
      expect(screen.getByText(/Ignored: node_modules\/dep\/index\.js/i)).toBeTruthy();
    });

    fireEvent.change(screen.getByPlaceholderText("owner/repo"), {
      target: { value: "openclaw/demo-plugin" },
    });
    fireEvent.change(screen.getByPlaceholderText("Full commit SHA"), {
      target: { value: "abc123" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Publish plugin" }));

    await waitFor(() => {
      expect(publishRelease).toHaveBeenCalledTimes(1);
    });

    expect(generateUploadUrl).toHaveBeenCalledTimes(5);
    const payload = publishRelease.mock.calls[0]?.[0]?.payload as {
      files: Array<{ path: string }>;
    };
    expect(payload.files.map((file) => file.path).sort()).toEqual([
      ".gitignore",
      "dist/index.js",
      "openclaw.plugin.json",
      "package.json",
      "src/index.js",
    ]);
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
      expect(
        screen.getAllByText(/Each file must be 10MB or smaller: plugin\.wasm/i).length,
      ).toBeGreaterThan(0);
    });
    expect(
      screen.getByRole("button", { name: "Publish plugin" }).getAttribute("disabled"),
    ).not.toBeNull();
    expect(publishRelease).not.toHaveBeenCalled();
  });

  it("shows pending verification messaging after staged plugin publish", async () => {
    publishRelease.mockResolvedValueOnce({
      ok: true,
      status: "pending",
      attemptId: "publishAttempts:1",
      packageName: "demo-plugin",
      version: "1.0.0",
    });
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
    fireEvent.change(screen.getByPlaceholderText("owner/repo"), {
      target: { value: "openclaw/demo-plugin" },
    });
    fireEvent.change(screen.getByPlaceholderText("Full commit SHA"), {
      target: { value: "abc123" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Publish plugin" }));

    expect(
      await screen.findByText(/Running TruffleHog and ClawScan before public listing\./i),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Publish plugin" }).getAttribute("disabled"),
    ).not.toBeNull();
  });

  it("warns when README references relative image paths but no source repo/commit is set", async () => {
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
    const readme = withRelativePath(
      new File(
        ['# Demo Plugin\n\n![diagram](./images/foo.png)\n\n<img src="./images/bar.png" alt="x"/>'],
        "README.md",
        { type: "text/markdown" },
      ),
      "demo-plugin/README.md",
    );

    fireEvent.change(getFileInput(), { target: { files: [packageJson, manifest, readme] } });

    await waitFor(() => {
      expect(screen.getByText(/2 package-relative image paths/i)).toBeTruthy();
    });
    expect(screen.getByText(/can't resolve them to your source host/i)).toBeTruthy();
    expect(screen.getByText(/\.\/images\/foo\.png/)).toBeTruthy();
    expect(screen.getByText(/\.\/images\/bar\.png/)).toBeTruthy();
  });

  it("warns when README picture source srcset references relative image paths", async () => {
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
    const readme = withRelativePath(
      new File(
        [
          '# Demo Plugin\n\n<picture><source media="(prefers-color-scheme: dark)" srcset="./images/dark.png 1x, ./images/dark@2x.png 2x"><img src="https://example.com/fallback.png" alt="x"></picture>',
        ],
        "README.md",
        { type: "text/markdown" },
      ),
      "demo-plugin/README.md",
    );

    fireEvent.change(getFileInput(), { target: { files: [packageJson, manifest, readme] } });

    await waitFor(() => {
      expect(screen.getByText(/2 package-relative image paths/i)).toBeTruthy();
    });
    expect(screen.getByText(/\.\/images\/dark\.png/)).toBeTruthy();
    expect(screen.getByText(/\.\/images\/dark@2x\.png/)).toBeTruthy();
  });

  it("swaps the missing-source warning for a Package-path reminder once Source repo and a valid 40-hex Source commit are filled", async () => {
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
    const readme = withRelativePath(
      new File(["# Demo\n\n![diagram](./images/foo.png)\n"], "README.md", {
        type: "text/markdown",
      }),
      "demo-plugin/README.md",
    );

    fireEvent.change(getFileInput(), { target: { files: [packageJson, manifest, readme] } });

    await waitFor(() => {
      expect(screen.getByText(/a package-relative image path/i)).toBeTruthy();
    });
    // Before source is filled, the missing-source copy is shown.
    expect(screen.getByText(/Without Source repo \+ Commit SHA/i)).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("owner/repo"), {
      target: { value: "openclaw/demo-plugin" },
    });
    // Use a real 40-hex SHA so buildReadmeAssetBaseUrl actually accepts it
    // and the publish form's promise lines up with the renderer's behavior.
    const validSha = "abc1234567890abcdef1234567890abcdef12345";
    fireEvent.change(screen.getByPlaceholderText("Full commit SHA"), {
      target: { value: validSha },
    });

    // After source is filled, the missing-source copy disappears but a softer
    // reminder remains, prompting the publisher to verify Package path against
    // the constructed raw.githubusercontent.com URL preview.
    await waitFor(() => {
      expect(screen.queryByText(/Without Source repo \+ Commit SHA/i)).toBeNull();
    });
    expect(screen.getByText(/make sure Package path matches/i)).toBeTruthy();
    expect(
      screen.getByText(
        new RegExp(`raw\\.githubusercontent\\.com/openclaw/demo-plugin/${validSha}/`, "i"),
      ),
    ).toBeTruthy();
  });

  it("keeps the missing-source warning when Source commit is not a valid 40-hex SHA, because the renderer would silently drop the rewrite", async () => {
    // Regression: the form previously accepted any non-empty Commit SHA and
    // promised relative README images would be served from raw.githubusercontent.com,
    // but buildReadmeAssetBaseUrl (used at render time) requires a 40-hex SHA
    // and silently returns undefined for shorter or otherwise malformed input.
    // The result: the publisher saw a green-light reminder, shipped, and the
    // detail page 404'd. The form must now hold the renderer's validation line.
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
    const readme = withRelativePath(
      new File(["# Demo\n\n![diagram](./images/foo.png)\n"], "README.md", {
        type: "text/markdown",
      }),
      "demo-plugin/README.md",
    );

    fireEvent.change(getFileInput(), { target: { files: [packageJson, manifest, readme] } });

    await waitFor(() => {
      expect(screen.getByText(/Without Source repo \+ Commit SHA/i)).toBeTruthy();
    });

    fireEvent.change(screen.getByPlaceholderText("owner/repo"), {
      target: { value: "openclaw/demo-plugin" },
    });
    // 7-char short SHA: GitHub itself would resolve this, but our render-time
    // base-URL builder rejects anything that isn't 40 hex chars, so the form
    // must keep showing the missing-source copy rather than the "will be
    // served from raw.githubusercontent.com" reminder.
    fireEvent.change(screen.getByPlaceholderText("Full commit SHA"), {
      target: { value: "abc1234" },
    });

    // Give React a tick to recompute the warning useMemo.
    await waitFor(() => {
      expect(screen.getByText(/Without Source repo \+ Commit SHA/i)).toBeTruthy();
    });
    expect(screen.queryByText(/make sure Package path matches/i)).toBeNull();
    expect(
      screen.queryByText(/raw\.githubusercontent\.com\/openclaw\/demo-plugin\/abc1234/i),
    ).toBeNull();
  });

  it("keeps the missing-source warning when Package path cannot be resolved safely", async () => {
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
    const readme = withRelativePath(
      new File(["# Demo\n\n![diagram](./images/foo.png)\n"], "README.md", {
        type: "text/markdown",
      }),
      "demo-plugin/README.md",
    );

    fireEvent.change(getFileInput(), { target: { files: [packageJson, manifest, readme] } });

    await waitFor(() => {
      expect(screen.getByText(/Without Source repo \+ Commit SHA/i)).toBeTruthy();
    });

    fireEvent.change(screen.getByPlaceholderText("owner/repo"), {
      target: { value: "openclaw/demo-plugin" },
    });
    fireEvent.change(screen.getByPlaceholderText("Full commit SHA"), {
      target: { value: "abc1234567890abcdef1234567890abcdef12345" },
    });
    fireEvent.change(screen.getByPlaceholderText("."), {
      target: { value: "../demo-plugin" },
    });

    await waitFor(() => {
      expect(screen.getByText(/Without Source repo \+ Commit SHA/i)).toBeTruthy();
    });
    expect(screen.queryByText(/make sure Package path matches/i)).toBeNull();
    expect(screen.queryByText(/raw\.githubusercontent\.com\/openclaw\/demo-plugin/i)).toBeNull();
  });

  it("stops nudging about Package path once source is filled and the README has no relative images", async () => {
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
    const readme = withRelativePath(
      new File(["# Demo\n\n![ok](https://example.com/foo.png)\n"], "README.md", {
        type: "text/markdown",
      }),
      "demo-plugin/README.md",
    );

    fireEvent.change(getFileInput(), { target: { files: [packageJson, manifest, readme] } });

    await waitFor(() => {
      expect(screen.getByDisplayValue("demo-plugin")).toBeTruthy();
    });
    fireEvent.change(screen.getByPlaceholderText("owner/repo"), {
      target: { value: "openclaw/demo-plugin" },
    });
    fireEvent.change(screen.getByPlaceholderText("Full commit SHA"), {
      target: { value: "abc1234567890abcdef1234567890abcdef12345" },
    });

    expect(screen.queryByText(/Your README references/i)).toBeNull();
    expect(screen.queryByText(/make sure Package path matches/i)).toBeNull();
  });

  it("keeps warning about root-absolute README image paths even when Source repo and Source commit are filled", async () => {
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
    const readme = withRelativePath(
      new File(["# Demo\n\n![logo](/static/logo.png)\n"], "README.md", {
        type: "text/markdown",
      }),
      "demo-plugin/README.md",
    );

    fireEvent.change(getFileInput(), { target: { files: [packageJson, manifest, readme] } });

    await waitFor(() => {
      expect(screen.getByText(/a root-absolute image path/i)).toBeTruthy();
    });

    fireEvent.change(screen.getByPlaceholderText("owner/repo"), {
      target: { value: "openclaw/demo-plugin" },
    });
    fireEvent.change(screen.getByPlaceholderText("Full commit SHA"), {
      target: { value: "abc1234567890abcdef1234567890abcdef12345" },
    });

    // Filling in source metadata must not silence the unresolvable warning,
    // because root-absolute paths are never rewritten by the renderer.
    expect(screen.getByText(/a root-absolute image path/i)).toBeTruthy();
    expect(screen.getByText(/\/static\/logo\.png/)).toBeTruthy();
  });

  it("does not warn when README only uses absolute image URLs", async () => {
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
    const readme = withRelativePath(
      new File(["# Demo\n\n![ok](https://example.com/foo.png)\n"], "README.md", {
        type: "text/markdown",
      }),
      "demo-plugin/README.md",
    );

    fireEvent.change(getFileInput(), { target: { files: [packageJson, manifest, readme] } });

    await waitFor(() => {
      expect(screen.getByDisplayValue("demo-plugin")).toBeTruthy();
    });
    expect(screen.queryByText(/Your README references/i)).toBeNull();
  });

  it("clears the README relative-asset warning when the user clears the selected package", async () => {
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
    const readme = withRelativePath(
      new File(["# Demo\n\n![diagram](./images/foo.png)\n"], "README.md", {
        type: "text/markdown",
      }),
      "demo-plugin/README.md",
    );

    fireEvent.change(getFileInput(), { target: { files: [packageJson, manifest, readme] } });

    await waitFor(() => {
      expect(screen.getByText(/a package-relative image path/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Clear package/i }));

    // The Badge must not keep parroting the previous package's findings once
    // the user has cleared the selection — otherwise the next pick window
    // briefly shows stale warnings.
    await waitFor(() => {
      expect(screen.queryByText(/Your README references/i)).toBeNull();
    });
  });
});
