import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Upload } from "../routes/skills/publish";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component: unknown }) => config,
  useNavigate: () => vi.fn(),
  useSearch: () => useSearchMock(),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: vi.fn() }),
}));

const generateUploadUrl = vi.fn();
const publishVersion = vi.fn();
const generateChangelogPreview = vi.fn();
const fetchMock = vi.fn();
const useQueryMock = vi.fn();
const useAuthStatusMock = vi.fn();
// Allows individual test cases to drive the value `useSearch` returns.
// The `updateSlug` search param triggers the form's "update existing"
// branch and is required by the F1 regression cases below.
const useSearchMock = vi.fn();
let useActionCallCount = 0;

vi.mock("convex/react", () => ({
  ConvexReactClient: class {},
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: () => generateUploadUrl,
  useAction: () => {
    useActionCallCount += 1;
    return useActionCallCount % 2 === 1 ? publishVersion : generateChangelogPreview;
  },
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => useAuthStatusMock(),
}));

describe("Upload route", () => {
  beforeEach(() => {
    generateUploadUrl.mockReset();
    publishVersion.mockReset();
    generateChangelogPreview.mockReset();
    fetchMock.mockReset();
    useQueryMock.mockReset();
    useAuthStatusMock.mockReset();
    useSearchMock.mockReset();
    useSearchMock.mockReturnValue({ updateSlug: undefined, ownerHandle: undefined });
    useActionCallCount = 0;
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:1" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args === undefined) {
        return [
          {
            publisher: {
              _id: "publishers:local",
              handle: "local",
              displayName: "Local",
              kind: "user",
            },
            role: "owner",
          },
        ];
      }
      return null;
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ storageId: "storage-id" }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows validation issues before submit", async () => {
    render(<Upload />);
    const publishButton = screen.getByRole("button", { name: /publish/i });
    expect(publishButton.getAttribute("disabled")).not.toBeNull();
    expect(screen.getAllByText(/Slug is required/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Display name is required/i).length).toBeGreaterThan(0);
  });

  it("marks the input for folder uploads", async () => {
    render(<Upload />);
    const input = screen.getByTestId("upload-input");
    await waitFor(() => {
      expect(input.getAttribute("webkitdirectory")).not.toBeNull();
    });
  });

  it("enables publish when fields and files are valid", async () => {
    generateUploadUrl.mockResolvedValue("https://upload.local");
    render(<Upload />);
    fireEvent.change(screen.getByPlaceholderText("skill-name"), {
      target: { value: "cool-skill" },
    });
    fireEvent.change(screen.getByPlaceholderText("My skill"), {
      target: { value: "Cool Skill" },
    });
    fireEvent.change(screen.getByPlaceholderText("1.0.0"), {
      target: { value: "1.2.3" },
    });
    fireEvent.change(screen.getByPlaceholderText("latest, stable"), {
      target: { value: "latest" },
    });
    const file = new File(["hello"], "SKILL.md", { type: "text/markdown" });
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /i have the rights to this skill and agree to publish it under mit-0/i,
      }),
    );

    const publishButton = screen.getByRole("button", { name: /publish/i }) as HTMLButtonElement;
    expect(await screen.findByText(/All checks passed/i)).toBeTruthy();
    expect(publishButton.getAttribute("disabled")).toBeNull();
  });

  it("extracts zip uploads and unwraps top-level folders", async () => {
    render(<Upload />);
    fireEvent.change(screen.getByPlaceholderText("skill-name"), {
      target: { value: "cool-skill" },
    });
    fireEvent.change(screen.getByPlaceholderText("My skill"), {
      target: { value: "Cool Skill" },
    });
    fireEvent.change(screen.getByPlaceholderText("1.0.0"), {
      target: { value: "1.2.3" },
    });
    fireEvent.change(screen.getByPlaceholderText("latest, stable"), {
      target: { value: "latest" },
    });

    const zip = zipSync({
      "hetzner-cloud-skill/SKILL.md": new Uint8Array(strToU8("hello")),
      "hetzner-cloud-skill/notes.txt": new Uint8Array(strToU8("notes")),
    });
    const zipBytes = Uint8Array.from(zip).buffer;
    const zipFile = new File([zipBytes], "bundle.zip", { type: "application/zip" });

    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [zipFile] } });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /i have the rights to this skill and agree to publish it under mit-0/i,
      }),
    );

    expect(await screen.findByText("notes.txt", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText("SKILL.md")).toBeTruthy();
    expect(await screen.findByText(/All checks passed/i, {}, { timeout: 3000 })).toBeTruthy();
  });

  it("unwraps folder uploads so SKILL.md can be at the top-level", async () => {
    generateUploadUrl.mockResolvedValue("https://upload.local");
    publishVersion.mockResolvedValue(undefined);
    render(<Upload />);
    fireEvent.change(screen.getByPlaceholderText("skill-name"), {
      target: { value: "ynab" },
    });
    fireEvent.change(screen.getByPlaceholderText("My skill"), {
      target: { value: "YNAB" },
    });
    fireEvent.change(screen.getByPlaceholderText("1.0.0"), {
      target: { value: "1.0.0" },
    });
    fireEvent.change(screen.getByPlaceholderText("latest, stable"), {
      target: { value: "latest" },
    });
    fireEvent.change(screen.getByLabelText("ClawScan note"), {
      target: { value: "Needs network access to call the user-configured YNAB API." },
    });

    const file = new File(["hello"], "SKILL.md", { type: "text/markdown" });
    Object.defineProperty(file, "webkitRelativePath", { value: "ynab/SKILL.md" });

    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /i have the rights to this skill and agree to publish it under mit-0/i,
      }),
    );

    expect(await screen.findByText("SKILL.md")).toBeTruthy();
    expect(await screen.findByText(/All checks passed/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    await waitFor(() => {
      expect(
        publishVersion.mock.calls.some((call) =>
          Array.isArray((call[0] as { files?: unknown }).files),
        ),
      ).toBe(true);
    });
    const args = publishVersion.mock.calls
      .map((call) => call[0] as { files?: Array<{ path: string }>; clawScanNote?: string })
      .find((call) => Array.isArray(call.files));
    expect(args?.files?.[0]?.path).toBe("SKILL.md");
    expect(args?.clawScanNote).toBe("Needs network access to call the user-configured YNAB API.");
  });

  it("blocks non-text folder uploads (png)", async () => {
    render(<Upload />);
    fireEvent.change(screen.getByPlaceholderText("skill-name"), {
      target: { value: "cool-skill" },
    });
    fireEvent.change(screen.getByPlaceholderText("My skill"), {
      target: { value: "Cool Skill" },
    });
    fireEvent.change(screen.getByPlaceholderText("1.0.0"), {
      target: { value: "1.2.3" },
    });
    fireEvent.change(screen.getByPlaceholderText("latest, stable"), {
      target: { value: "latest" },
    });

    const skill = new File(["hello"], "SKILL.md", { type: "text/markdown" });
    const png = new File([new Uint8Array([137, 80, 78, 71]).buffer], "screenshot.png", {
      type: "image/png",
    });
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [skill, png] } });

    expect(await screen.findByText("screenshot.png")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    expect(
      (await screen.findAllByText(/Remove non-text files: screenshot\.png/i)).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("screenshot.png")).toBeTruthy();
  });

  it("surfaces file validation next to the upload input", async () => {
    render(<Upload />);

    const notes = new File(["hello"], "notes.md", { type: "text/markdown" });
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [notes] } });

    expect(await screen.findByText("SKILL.md is required.")).toBeTruthy();
  });

  it("shows a validation error when a skill file exceeds 10MB", async () => {
    render(<Upload />);
    fireEvent.change(screen.getByPlaceholderText("skill-name"), {
      target: { value: "cool-skill" },
    });
    fireEvent.change(screen.getByPlaceholderText("My skill"), {
      target: { value: "Cool Skill" },
    });
    fireEvent.change(screen.getByPlaceholderText("1.0.0"), {
      target: { value: "1.2.3" },
    });
    fireEvent.change(screen.getByPlaceholderText("latest, stable"), {
      target: { value: "latest" },
    });

    const skill = new File(["hello"], "SKILL.md", { type: "text/markdown" });
    const huge = new File(["x"], "notes.md", { type: "text/markdown" });
    Object.defineProperty(huge, "size", {
      value: 10 * 1024 * 1024 + 1,
      configurable: true,
    });

    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [skill, huge] } });

    expect(
      (await screen.findAllByText(/Each file must be 10MB or smaller: notes\.md/i)).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /publish skill/i }).getAttribute("disabled"),
    ).not.toBeNull();
  });

  it("shows an informational note when mac junk files are ignored", async () => {
    render(<Upload />);
    fireEvent.change(screen.getByPlaceholderText("skill-name"), {
      target: { value: "cool-skill" },
    });
    fireEvent.change(screen.getByPlaceholderText("My skill"), {
      target: { value: "Cool Skill" },
    });
    fireEvent.change(screen.getByPlaceholderText("1.0.0"), {
      target: { value: "1.2.3" },
    });
    fireEvent.change(screen.getByPlaceholderText("latest, stable"), {
      target: { value: "latest" },
    });

    const skill = new File(["hello"], "SKILL.md", { type: "text/markdown" });
    const junk = new File(["junk"], ".DS_Store", { type: "application/octet-stream" });
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [skill, junk] } });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /i have the rights to this skill and agree to publish it under mit-0/i,
      }),
    );

    expect(await screen.findByText("SKILL.md")).toBeTruthy();
    expect(screen.queryByText(".DS_Store")).toBeNull();
    expect(await screen.findByText(/Ignored 1 macOS junk file/i)).toBeTruthy();
    expect(await screen.findByText(/All checks passed/i)).toBeTruthy();
  });

  it("surfaces publish errors and stays on page", async () => {
    publishVersion.mockRejectedValueOnce(new Error("Changelog is required"));
    generateUploadUrl.mockResolvedValue("https://upload.local");
    render(<Upload />);
    fireEvent.change(screen.getByPlaceholderText("skill-name"), {
      target: { value: "cool-skill" },
    });
    fireEvent.change(screen.getByPlaceholderText("My skill"), {
      target: { value: "Cool Skill" },
    });
    fireEvent.change(screen.getByPlaceholderText("1.0.0"), {
      target: { value: "1.2.3" },
    });
    fireEvent.change(screen.getByPlaceholderText("latest, stable"), {
      target: { value: "latest" },
    });
    fireEvent.change(screen.getByPlaceholderText("Describe what changed in this skill..."), {
      target: { value: "Initial drop." },
    });
    const file = new File(["hello"], "SKILL.md", { type: "text/markdown" });
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /i have the rights to this skill and agree to publish it under mit-0/i,
      }),
    );
    const publishButton = screen.getByRole("button", { name: /publish/i }) as HTMLButtonElement;
    await screen.findByText(/All checks passed/i);
    fireEvent.click(publishButton);
    expect(await screen.findByText(/Changelog is required/i)).toBeTruthy();
  });

  it("blocks publish in preflight when slug availability reports a collision", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args === undefined) {
        return [
          {
            publisher: {
              _id: "publishers:local",
              handle: "local",
              displayName: "Local",
              kind: "user",
            },
            role: "owner",
          },
        ];
      }
      if (
        args &&
        typeof args === "object" &&
        "slug" in (args as Record<string, unknown>) &&
        (args as Record<string, unknown>).slug === "taken-skill"
      ) {
        return {
          available: false,
          reason: "taken",
          message: "Slug is already taken. Choose a different slug.",
          url: "/alice/taken-skill",
        };
      }
      return null;
    });

    render(<Upload />);
    fireEvent.change(screen.getByPlaceholderText("skill-name"), {
      target: { value: "taken-skill" },
    });
    fireEvent.change(screen.getByPlaceholderText("My skill"), {
      target: { value: "Taken Skill" },
    });
    fireEvent.change(screen.getByPlaceholderText("1.0.0"), {
      target: { value: "1.2.3" },
    });
    fireEvent.change(screen.getByPlaceholderText("latest, stable"), {
      target: { value: "latest" },
    });
    fireEvent.change(screen.getByPlaceholderText("Describe what changed in this skill..."), {
      target: { value: "Initial drop." },
    });
    const file = new File(["hello"], "SKILL.md", { type: "text/markdown" });
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(
      (await screen.findAllByText(/Slug is already taken\. Choose a different slug\./i)).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "/alice/taken-skill" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /publish skill/i }).getAttribute("disabled"),
    ).not.toBeNull();
  });

  it("uses the ownerHandle search param for the owner selector and slug availability", async () => {
    useSearchMock.mockReturnValue({ updateSlug: undefined, ownerHandle: "clawkit" });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (
        args &&
        typeof args === "object" &&
        "slug" in (args as Record<string, unknown>) &&
        (args as Record<string, unknown>).slug === "org-skill"
      ) {
        return {
          available: true,
          reason: "available",
          message: null,
          url: null,
        };
      }
      return [
        {
          publisher: {
            _id: "publishers:clawkit",
            handle: "clawkit",
            displayName: "ClawKit",
            kind: "org",
          },
          role: "admin",
        },
      ];
    });

    render(<Upload />);
    fireEvent.change(screen.getByPlaceholderText("skill-name"), {
      target: { value: "org-skill" },
    });

    expect((screen.getByLabelText("Owner") as HTMLSelectElement).value).toBe("clawkit");
    await waitFor(() => {
      expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), {
        slug: "org-skill",
        ownerHandle: "clawkit",
      });
    });
  });

  it("reconciles the selected owner when publisher memberships change", async () => {
    let memberships = [
      {
        publisher: {
          _id: "publishers:local",
          handle: "local",
          displayName: "Local Owner",
          kind: "user",
        },
        role: "owner",
      },
    ];
    useQueryMock.mockImplementation((fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      const name = fn ? getFunctionName(fn as Parameters<typeof getFunctionName>[0]) : "";
      if (name === "publishers:listMine") return memberships;
      if (name === "skills:checkSlugAvailability") {
        return {
          available: true,
          reason: "available",
          message: null,
          url: null,
        };
      }
      return null;
    });

    const { rerender } = render(<Upload />);

    await waitFor(() => {
      expect((screen.getByLabelText("Owner") as HTMLSelectElement).value).toBe("local");
    });

    memberships = [
      {
        publisher: {
          _id: "publishers:local-owner",
          handle: "local-owner",
          displayName: "Local Owner",
          kind: "user",
        },
        role: "owner",
      },
    ];
    rerender(<Upload />);

    await waitFor(() => {
      expect((screen.getByLabelText("Owner") as HTMLSelectElement).value).toBe("local-owner");
    });

    fireEvent.change(screen.getByPlaceholderText("skill-name"), {
      target: { value: "owner-race" },
    });
    await waitFor(() => {
      expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), {
        slug: "owner-race",
        ownerHandle: "local-owner",
      });
    });
  });

  it("renders the icon picker and forwards the selected lucide icon to publishVersion", async () => {
    generateUploadUrl.mockResolvedValue("https://upload.local");
    publishVersion.mockResolvedValue(undefined);
    render(<Upload />);

    // Picker is visible in skill mode and defaults to "No icon".
    const noneTile = screen.getByRole("radio", { name: "No icon" });
    expect(noneTile.getAttribute("aria-checked")).toBe("true");

    fireEvent.change(screen.getByPlaceholderText("skill-name"), {
      target: { value: "with-icon" },
    });
    fireEvent.change(screen.getByPlaceholderText("My skill"), {
      target: { value: "With Icon" },
    });
    fireEvent.change(screen.getByPlaceholderText("1.0.0"), {
      target: { value: "1.0.0" },
    });
    fireEvent.change(screen.getByPlaceholderText("latest, stable"), {
      target: { value: "latest" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Plug" }));
    expect(screen.getByRole("radio", { name: "Plug" }).getAttribute("aria-checked")).toBe("true");

    const file = new File(["hello"], "SKILL.md", { type: "text/markdown" });
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /i have the rights to this skill and agree to publish it under mit-0/i,
      }),
    );

    await screen.findByText(/All checks passed/i);
    fireEvent.click(screen.getByRole("button", { name: /publish skill/i }));

    await waitFor(() => {
      expect(
        publishVersion.mock.calls.some((call) =>
          Array.isArray((call[0] as { files?: unknown }).files),
        ),
      ).toBe(true);
    });
    const args = publishVersion.mock.calls
      .map((call) => call[0] as { icon?: string; files?: unknown })
      .find((call) => Array.isArray(call.files));
    expect(args?.icon).toBe("lucide:Plug");
  });

  it("sends an empty icon string when the publisher explicitly picks 'No icon'", async () => {
    generateUploadUrl.mockResolvedValue("https://upload.local");
    publishVersion.mockResolvedValue(undefined);
    render(<Upload />);

    fireEvent.change(screen.getByPlaceholderText("skill-name"), {
      target: { value: "no-icon-skill" },
    });
    fireEvent.change(screen.getByPlaceholderText("My skill"), {
      target: { value: "No Icon Skill" },
    });
    fireEvent.change(screen.getByPlaceholderText("1.0.0"), {
      target: { value: "1.0.0" },
    });
    fireEvent.change(screen.getByPlaceholderText("latest, stable"), {
      target: { value: "latest" },
    });

    // Pick then unpick so the publisher's intent is recorded as "clear".
    fireEvent.click(screen.getByRole("radio", { name: "Plug" }));
    fireEvent.click(screen.getByRole("radio", { name: "No icon" }));

    const file = new File(["hello"], "SKILL.md", { type: "text/markdown" });
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /i have the rights to this skill and agree to publish it under mit-0/i,
      }),
    );

    await screen.findByText(/All checks passed/i);
    fireEvent.click(screen.getByRole("button", { name: /publish skill/i }));

    await waitFor(() => {
      expect(
        publishVersion.mock.calls.some((call) =>
          Array.isArray((call[0] as { files?: unknown }).files),
        ),
      ).toBe(true);
    });
    const args = publishVersion.mock.calls
      .map((call) => call[0] as { icon?: string; files?: unknown })
      .find((call) => Array.isArray(call.files));
    // The publish form distinguishes "clear" (empty string) from "untouched"
    // (key absent). Since the picker is always present in skill mode, even
    // the default state forwards an explicit empty string.
    expect(args).toHaveProperty("icon");
    expect(args?.icon).toBe("");
  });

  it("preserves the existing icon when republishing without touching the picker (F1)", async () => {
    // Simulate a `New Version` flow: `?updateSlug=with-icon` is in the URL
    // and the existing skill row carries `icon: \"lucide:Plug\"`.
    useSearchMock.mockReturnValue({ updateSlug: "with-icon" });
    useQueryMock.mockImplementation((fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      // The convex `anyApi` proxy returns a fresh proxy on every property
      // access, so reference equality on `api.skills.getBySlug` is unsafe.
      // `getFunctionName` resolves the proxy to its stable string id
      // (e.g. `"skills:getBySlug"`).
      const name = fn ? getFunctionName(fn as Parameters<typeof getFunctionName>[0]) : "";
      if (name === "skills:getBySlug") {
        return {
          skill: {
            slug: "with-icon",
            displayName: "With Icon",
            icon: "lucide:Plug",
          },
          latestVersion: { version: "1.0.0", clawScanNote: null },
          owner: { handle: "alice", displayName: "Alice" },
        };
      }
      // checkSlugAvailability + listMine + everything else stays default.
      return null;
    });
    generateUploadUrl.mockResolvedValue("https://upload.local");
    publishVersion.mockResolvedValue(undefined);

    render(<Upload />);

    // The picker should be pre-populated to `Plug` from the stored value.
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Plug" }).getAttribute("aria-checked")).toBe("true");
    });

    // Routine version bump, never touch the picker.
    fireEvent.change(screen.getByPlaceholderText("1.0.0"), {
      target: { value: "1.0.1" },
    });
    fireEvent.change(screen.getByPlaceholderText("latest, stable"), {
      target: { value: "latest" },
    });
    fireEvent.change(screen.getByPlaceholderText("Describe what changed in this skill..."), {
      target: { value: "Routine bump." },
    });

    const file = new File(["hello"], "SKILL.md", { type: "text/markdown" });
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /i have the rights to this skill and agree to publish it under mit-0/i,
      }),
    );

    await screen.findByText(/All checks passed/i);
    fireEvent.click(screen.getByRole("button", { name: /publish skill/i }));

    await waitFor(() => {
      expect(
        publishVersion.mock.calls.some((call) =>
          Array.isArray((call[0] as { files?: unknown }).files),
        ),
      ).toBe(true);
    });
    const args = publishVersion.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .find((call) => Array.isArray(call.files));
    // The picker was never touched, so the form must omit `icon` entirely
    // and let the backend keep `skill.icon` as-is. Forwarding `\"\"` here
    // would silently clear the existing icon on a routine version bump.
    expect(args).not.toBeUndefined();
    expect(Object.hasOwn(args!, "icon")).toBe(false);
  });

  it("does not silently clear an unparseable existing icon on republish (F1)", async () => {
    // Same scenario as above, except the stored lucide name is no longer
    // in the client allow-list (e.g. `ALLOWED_LUCIDE_ICONS` was pruned in a
    // later deploy). `parseSkillIcon` returns `null`, the picker falls back
    // to \"No icon\", and pre-population leaves `iconName === null` without
    // any user interaction.
    useSearchMock.mockReturnValue({ updateSlug: "stale-icon" });
    useQueryMock.mockImplementation((fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      const name = fn ? getFunctionName(fn as Parameters<typeof getFunctionName>[0]) : "";
      if (name === "skills:getBySlug") {
        return {
          skill: {
            slug: "stale-icon",
            displayName: "Stale Icon",
            icon: "lucide:NoLongerAllowedGlyph",
          },
          latestVersion: { version: "1.0.0", clawScanNote: null },
          owner: { handle: "alice", displayName: "Alice" },
        };
      }
      return null;
    });
    generateUploadUrl.mockResolvedValue("https://upload.local");
    publishVersion.mockResolvedValue(undefined);

    render(<Upload />);

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "No icon" }).getAttribute("aria-checked")).toBe(
        "true",
      );
    });

    fireEvent.change(screen.getByPlaceholderText("1.0.0"), {
      target: { value: "1.0.1" },
    });
    fireEvent.change(screen.getByPlaceholderText("latest, stable"), {
      target: { value: "latest" },
    });
    fireEvent.change(screen.getByPlaceholderText("Describe what changed in this skill..."), {
      target: { value: "Routine bump." },
    });

    const file = new File(["hello"], "SKILL.md", { type: "text/markdown" });
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /i have the rights to this skill and agree to publish it under mit-0/i,
      }),
    );

    await screen.findByText(/All checks passed/i);
    fireEvent.click(screen.getByRole("button", { name: /publish skill/i }));

    await waitFor(() => {
      expect(
        publishVersion.mock.calls.some((call) =>
          Array.isArray((call[0] as { files?: unknown }).files),
        ),
      ).toBe(true);
    });
    const args = publishVersion.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .find((call) => Array.isArray(call.files));
    // Even though the picker visually shows \"No icon\" because the stored
    // lucide name is no longer renderable, the user did not interact with
    // it. We must NOT forward `icon: \"\"` (which the backend would treat
    // as an explicit clear), so that the next time the publisher visits
    // the form with an updated allow-list, their original icon is still
    // there.
    expect(args).not.toBeUndefined();
    expect(Object.hasOwn(args!, "icon")).toBe(false);
  });
});
