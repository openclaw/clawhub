import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    (path: string) =>
    (config: { component: unknown }) => ({ __config: config, __path: path }),
}));

const generateUploadUrl = vi.fn();
const publishRelease = vi.fn();
const fetchMock = vi.fn();
const useAuthStatusMock = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: () => generateUploadUrl,
  useAction: () => publishRelease,
  useQuery: () => undefined,
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => useAuthStatusMock(),
}));

import { Route } from "../routes/plugins/new";

function renderPublishRoute() {
  const route = Route as unknown as {
    __config: {
      component: unknown;
    };
  };
  render(createElement(route.__config.component as never));
}

function withRelativePath(file: File, path: string) {
  Object.defineProperty(file, "webkitRelativePath", {
    value: path,
    configurable: true,
  });
  return file;
}

function getFileInput() {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("Missing file input");
  return input;
}

describe("plugins publish route", () => {
  beforeEach(() => {
    generateUploadUrl.mockReset();
    publishRelease.mockReset();
    fetchMock.mockReset();
    useAuthStatusMock.mockReset();

    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:1" },
    });
    generateUploadUrl.mockResolvedValue("https://upload.local");
    publishRelease.mockResolvedValue({ ok: true, packageId: "pkg:1", releaseId: "rel:1" });
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        storageId: `storage:${((init?.body as File | undefined)?.name ?? "unknown").replaceAll("/", "_")}`,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers the publish form on /plugins/new", () => {
    const route = Route as unknown as {
      __path: string;
    };

    expect(route.__path).toBe("/plugins/new");
  });

  it("publishes a code plugin folder with source metadata and normalized file paths", async () => {
    renderPublishRoute();

    const packageJson = withRelativePath(
      new File(
        [
          JSON.stringify({
            name: "demo-plugin",
            displayName: "Demo Plugin",
            version: "1.2.3",
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

  it("publishes a bundle plugin folder with bundle metadata", async () => {
    renderPublishRoute();

    fireEvent.change(screen.getAllByRole("combobox")[0], {
      target: { value: "bundle-plugin" },
    });

    const packageJson = withRelativePath(
      new File(
        [
          JSON.stringify({
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
      new File(['{"id":"demo.bundle"}'], "openclaw.bundle.json", { type: "application/json" }),
      "demo-bundle/openclaw.bundle.json",
    );
    const binary = withRelativePath(
      new File([new Uint8Array([1, 2, 3])], "plugin.wasm", { type: "application/wasm" }),
      "demo-bundle/dist/plugin.wasm",
    );

    fireEvent.change(getFileInput(), { target: { files: [packageJson, manifest, binary] } });

    await waitFor(() => {
      expect(screen.getByDisplayValue("demo-bundle")).toBeTruthy();
      expect(screen.getByDisplayValue("Demo Bundle")).toBeTruthy();
      expect(screen.getByDisplayValue("0.4.0")).toBeTruthy();
    });

    fireEvent.change(screen.getByPlaceholderText("Changelog"), {
      target: { value: "Bundle release" },
    });
    fireEvent.change(screen.getByPlaceholderText("Bundle format"), {
      target: { value: "openclaw-bundle" },
    });
    fireEvent.change(screen.getByPlaceholderText("Host targets (comma separated)"), {
      target: { value: "desktop, mobile" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => {
      expect(publishRelease).toHaveBeenCalledTimes(1);
    });

    expect(generateUploadUrl).toHaveBeenCalledTimes(3);
    expect(publishRelease).toHaveBeenCalledWith({
      payload: expect.objectContaining({
        name: "demo-bundle",
        displayName: "Demo Bundle",
        family: "bundle-plugin",
        version: "0.4.0",
        changelog: "Bundle release",
        bundle: {
          format: "openclaw-bundle",
          hostTargets: ["desktop", "mobile"],
        },
        files: expect.arrayContaining([
          expect.objectContaining({ path: "package.json" }),
          expect.objectContaining({ path: "openclaw.bundle.json" }),
          expect.objectContaining({ path: "dist/plugin.wasm" }),
        ]),
      }),
    });
  });

  it("applies ignore rules before uploading a plugin folder", async () => {
    renderPublishRoute();

    const packageJson = withRelativePath(
      new File([JSON.stringify({ name: "demo-plugin", version: "1.0.0" })], "package.json", {
        type: "application/json",
      }),
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
      expect(screen.getByText(/Ignored 1 files via ignore rules\./)).toBeTruthy();
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
      new File([JSON.stringify({ name: "demo-plugin", version: "1.0.0" })], "package.json", {
        type: "application/json",
      }),
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
      new File([JSON.stringify({ name: "demo-plugin", version: "1.0.0" })], "package.json", {
        type: "application/json",
      }),
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
