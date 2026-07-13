import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { strToU8, zipSync } from "fflate";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { Upload } from "../routes/skills/publish";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
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

function selectCategory(name: string) {
  const trigger = screen.getByRole("button", { name: "Categories" });
  if (trigger.getAttribute("aria-expanded") !== "true") {
    fireEvent.pointerDown(trigger, { button: 0 });
  }
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name }));
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
}

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
    useQueryMock.mockImplementation((fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      const name = fn ? getFunctionName(fn as Parameters<typeof getFunctionName>[0]) : "";
      if (name === "publishers:listMine") {
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

  it("links to the skill docs", () => {
    render(<Upload />);

    const guideLink = screen.getByRole("link", { name: /Skill docs/i });
    expect(guideLink.getAttribute("href")).toBe("https://docs.openclaw.ai/clawhub/skill-format");
    expect(guideLink.getAttribute("target")).toBe("_blank");
  });

  it("drops invalid legacy category metadata and offers explicit generation on republish", async () => {
    useSearchMock.mockReturnValue({ updateSlug: "uncategorized-skill" });
    useQueryMock.mockImplementation((fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      const name = fn ? getFunctionName(fn as Parameters<typeof getFunctionName>[0]) : "";
      if (name === "skills:getBySlug") {
        return {
          skill: {
            slug: "uncategorized-skill",
            displayName: "Uncategorized Skill",
            categories: ["uncategorized"],
          },
          latestVersion: { version: "1.0.0" },
          owner: { handle: "alice", displayName: "Alice" },
        };
      }
      if (name === "publishers:listMine") return [];
      return null;
    });

    render(<Upload />);

    await waitFor(() => {
      expect(screen.getByText("0/3")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Generate categories" })).toBeTruthy();
    });
  });

  it("uses the existing summary for explicit category generation on republish", async () => {
    useSearchMock.mockReturnValue({ updateSlug: "summary-only-signal" });
    useQueryMock.mockImplementation((fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      const name = fn ? getFunctionName(fn as Parameters<typeof getFunctionName>[0]) : "";
      if (name === "skills:getBySlug") {
        return {
          skill: {
            slug: "summary-only-signal",
            displayName: "Summary Only Signal",
            summary: "Automate recurring workflows.",
          },
          latestVersion: { version: "1.0.0" },
          owner: { handle: "alice", displayName: "Alice" },
        };
      }
      return null;
    });

    render(<Upload />);

    fireEvent.click(await screen.findByRole("button", { name: "Generate categories" }));
    expect(screen.getByRole("button", { name: "Categories" }).textContent).toContain("Automation");
  });

  it("uses the uploaded SKILL.md description for explicit category generation", async () => {
    render(<Upload />);

    fireEvent.change(screen.getByPlaceholderText("My skill"), {
      target: { value: "Plain Skill" },
    });
    fireEvent.change(screen.getByPlaceholderText("skill-name"), {
      target: { value: "plain-skill" },
    });
    const file = new File(
      ["---\nname: plain-skill\ndescription: Automate recurring workflows.\n---\n# Plain Skill"],
      "SKILL.md",
      { type: "text/markdown" },
    );
    fireEvent.change(screen.getByTestId("upload-input"), { target: { files: [file] } });

    await waitFor(() => {
      fireEvent.click(screen.getByRole("button", { name: "Generate categories" }));
      expect(screen.getByRole("button", { name: "Categories" }).textContent).toContain(
        "Automation",
      );
    });
  });

  it("prefills short summary from SKILL.md description metadata", async () => {
    render(<Upload />);

    const file = new File(
      ["---\nname: plain-skill\ndescription: Automate recurring workflows.\n---\n# Plain Skill"],
      "SKILL.md",
      { type: "text/markdown" },
    );
    fireEvent.change(screen.getByTestId("upload-input"), { target: { files: [file] } });

    await waitFor(() => {
      expect((screen.getByLabelText("Summary") as HTMLTextAreaElement).value).toBe(
        "Automate recurring workflows.",
      );
      expect(screen.getByRole("note").textContent).toContain("Pulled from your SKILL.md.");
      expect(screen.getByRole("note").textContent).toContain("cards and search");
      expect(screen.queryByText(/Imported from your SKILL\.md/i)).toBeNull();
    });
  });

  it("truncates long SKILL.md descriptions when prefilling short summary", async () => {
    render(<Upload />);

    const longDescription = "a".repeat(350);
    const file = new File(
      [`---\nname: long-skill\ndescription: ${longDescription}\n---\n# Long Skill`],
      "SKILL.md",
      { type: "text/markdown" },
    );
    fireEvent.change(screen.getByTestId("upload-input"), { target: { files: [file] } });

    await waitFor(() => {
      const summary = screen.getByLabelText("Summary") as HTMLTextAreaElement;
      expect(summary.value).toHaveLength(300);
      expect(summary.value).toBe("a".repeat(300));
    });
  });

  it("hides the short summary recommendation when dismissed and keeps prefilled text", async () => {
    render(<Upload />);

    const file = new File(
      ["---\nname: plain-skill\ndescription: Automate recurring workflows.\n---\n# Plain Skill"],
      "SKILL.md",
      { type: "text/markdown" },
    );
    fireEvent.change(screen.getByTestId("upload-input"), { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole("note").textContent).toContain("Pulled from your SKILL.md.");
    });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss summary recommendation" }));

    expect(screen.queryByRole("note")).toBeNull();
    expect((screen.getByLabelText("Summary") as HTMLTextAreaElement).value).toBe(
      "Automate recurring workflows.",
    );
  });

  it("keeps manual short summary edits when SKILL.md is replaced", async () => {
    render(<Upload />);

    const firstFile = new File(["---\ndescription: First description.\n---\n# First"], "SKILL.md", {
      type: "text/markdown",
    });
    fireEvent.change(screen.getByTestId("upload-input"), { target: { files: [firstFile] } });

    await waitFor(() => {
      expect((screen.getByLabelText("Summary") as HTMLTextAreaElement).value).toBe(
        "First description.",
      );
    });

    fireEvent.change(screen.getByLabelText("Summary"), {
      target: { value: "Custom summary." },
    });

    expect(screen.queryByRole("note")).toBeNull();

    const secondFile = new File(
      ["---\ndescription: Second description.\n---\n# Second"],
      "SKILL.md",
      { type: "text/markdown" },
    );
    fireEvent.change(screen.getByTestId("upload-input"), { target: { files: [secondFile] } });

    await waitFor(() => {
      expect((screen.getByLabelText("Summary") as HTMLTextAreaElement).value).toBe(
        "Custom summary.",
      );
    });
  });

  it("prefills short summary again after a new upload following manual edits", async () => {
    render(<Upload />);

    const firstFile = new File(["---\ndescription: First description.\n---\n# First"], "SKILL.md", {
      type: "text/markdown",
    });
    fireEvent.change(screen.getByTestId("upload-input"), { target: { files: [firstFile] } });

    await waitFor(() => {
      expect((screen.getByLabelText("Summary") as HTMLTextAreaElement).value).toBe(
        "First description.",
      );
    });

    fireEvent.change(screen.getByLabelText("Summary"), {
      target: { value: "Custom summary." },
    });

    const secondFile = new File(
      ["---\ndescription: Second description.\n---\n# Second"],
      "SKILL.md",
      { type: "text/markdown" },
    );
    fireEvent.change(screen.getByTestId("upload-input"), { target: { files: [secondFile] } });

    await waitFor(() => {
      expect((screen.getByLabelText("Summary") as HTMLTextAreaElement).value).toBe(
        "Second description.",
      );
      expect(screen.getByRole("note").textContent).toContain("Pulled from your SKILL.md.");
    });
  });

  it("sends explicit empty metadata arrays when categories and topics are cleared on republish", async () => {
    useSearchMock.mockReturnValue({ updateSlug: "categorized-skill" });
    useQueryMock.mockImplementation((fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      const name = fn ? getFunctionName(fn as Parameters<typeof getFunctionName>[0]) : "";
      if (name === "skills:getBySlug") {
        return {
          skill: {
            slug: "categorized-skill",
            displayName: "Categorized Skill",
            categories: ["development"],
            topics: ["GPU development"],
          },
          latestVersion: { version: "1.0.0" },
          owner: { handle: "alice", displayName: "Alice" },
        };
      }
      return null;
    });
    generateUploadUrl.mockResolvedValue("https://upload.local");
    publishVersion.mockResolvedValue(undefined);

    render(<Upload />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Categories" }).textContent).toContain(
        "Development",
      );
    });
    selectCategory("Development");
    fireEvent.click(screen.getByRole("button", { name: "Remove GPU development topic" }));

    fireEvent.change(screen.getByPlaceholderText("Describe what changed in this skill..."), {
      target: { value: "Clear category override." },
    });
    const file = new File(["hello"], "SKILL.md", { type: "text/markdown" });
    fireEvent.change(screen.getByTestId("upload-input"), { target: { files: [file] } });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /i have the rights to publish this skill under its declared or default clawhub license/i,
      }),
    );

    const publishButton = screen.getByRole("button", { name: /publish skill/i });
    await waitFor(() => {
      expect(publishButton.getAttribute("disabled")).toBeNull();
    });
    fireEvent.click(publishButton);

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
    expect(args).toMatchObject({ categories: [], topics: [] });
  });

  it("keeps required validation quiet before submit", async () => {
    render(<Upload />);
    const publishButton = screen.getByRole("button", { name: /publish/i });
    const slugInput = screen.getByPlaceholderText("skill-name");
    const displayNameInput = screen.getByPlaceholderText("My skill");

    expect(publishButton.getAttribute("disabled")).not.toBeNull();
    expect(screen.queryByText(/Slug is required/i)).toBeNull();
    expect(screen.queryByText(/Display name is required/i)).toBeNull();

    fireEvent.focus(slugInput);
    fireEvent.blur(slugInput);
    fireEvent.focus(displayNameInput);
    fireEvent.blur(displayNameInput);

    expect(screen.queryByText(/Slug is required/i)).toBeNull();
    expect(screen.queryByText(/Display name is required/i)).toBeNull();

    fireEvent.submit(publishButton.closest("form") as HTMLFormElement);

    expect(await screen.findAllByText(/Slug is required/i)).not.toHaveLength(0);
    expect(await screen.findAllByText(/Display name is required/i)).not.toHaveLength(0);
  });

  it("does not duplicate inline required field errors in the metadata footer", () => {
    render(<Upload />);
    const displayNameInput = screen.getByPlaceholderText("My skill");

    fireEvent.change(displayNameInput, { target: { value: "Temporary skill" } });
    fireEvent.change(displayNameInput, { target: { value: "" } });

    const messages = screen.getAllByText(/Display name is required\./i);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe("display-name-validation-error");
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
        name: /i have the rights to publish this skill under its declared or default clawhub license/i,
      }),
    );

    const publishButton = screen.getByRole("button", { name: /publish/i }) as HTMLButtonElement;
    await waitFor(() => {
      expect(publishButton.getAttribute("disabled")).toBeNull();
    });
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
        name: /i have the rights to publish this skill under its declared or default clawhub license/i,
      }),
    );

    expect(await screen.findByText("notes.txt", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText("SKILL.md")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /publish/i }).getAttribute("disabled")).toBeNull();
    });
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

    const file = new File(["hello"], "SKILL.md", { type: "text/markdown" });
    Object.defineProperty(file, "webkitRelativePath", { value: "ynab/SKILL.md" });

    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /i have the rights to publish this skill under its declared or default clawhub license/i,
      }),
    );

    expect(await screen.findByText("SKILL.md")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /publish/i }).getAttribute("disabled")).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    await waitFor(() => {
      expect(
        publishVersion.mock.calls.some((call) =>
          Array.isArray((call[0] as { files?: unknown }).files),
        ),
      ).toBe(true);
    });
    const args = publishVersion.mock.calls
      .map((call) => call[0] as Record<string, unknown> & { files?: Array<{ path: string }> })
      .find((call) => Array.isArray(call.files));
    expect(args?.files?.[0]?.path).toBe("SKILL.md");
    expect(Object.hasOwn(args ?? {}, "categories")).toBe(false);
    expect(Object.hasOwn(args ?? {}, "topics")).toBe(false);
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
    expect(
      (await screen.findAllByText(/Remove unsupported files: screenshot\.png/i)).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("screenshot.png")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove unsupported" }));

    await waitFor(() => {
      expect(screen.queryByText("screenshot.png")).toBeNull();
    });
  });

  it("surfaces file validation next to the upload input", async () => {
    render(<Upload />);

    const notes = new File(["hello"], "notes.md", { type: "text/markdown" });
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [notes] } });

    expect(await screen.findByText("Missing")).toBeTruthy();
    expect(screen.getAllByText("SKILL.md").length).toBeGreaterThan(0);
  });

  it("allows extensionless root license files in browser uploads", async () => {
    render(<Upload />);

    const skill = new File(["hello"], "SKILL.md", { type: "text/markdown" });
    const license = new File(["MIT License"], "LICENSE", { type: "" });
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [skill, license] } });

    expect(await screen.findByText("LICENSE")).toBeTruthy();
    expect(screen.queryByText(/Remove unsupported files: LICENSE/i)).toBeNull();
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

  it("shows an informational note when local metadata files are ignored", async () => {
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
        name: /i have the rights to publish this skill under its declared or default clawhub license/i,
      }),
    );

    expect(await screen.findByText("SKILL.md")).toBeTruthy();
    expect(screen.queryByText(".DS_Store")).toBeNull();
    expect(await screen.findByText(/Ignored 1 local metadata file/i)).toBeTruthy();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /publish skill/i }).getAttribute("disabled"),
      ).toBeNull();
    });
  });

  it("ignores git metadata from dropped skill folders", async () => {
    render(<Upload />);

    const skill = new File(["hello"], "SKILL.md", { type: "text/markdown" });
    Object.defineProperty(skill, "webkitRelativePath", {
      value: "codex-run-to-completion/SKILL.md",
    });
    const gitConfig = new File(["[core]\n"], "config", { type: "text/plain" });
    Object.defineProperty(gitConfig, "webkitRelativePath", {
      value: "codex-run-to-completion/.git/config",
    });
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [skill, gitConfig] } });

    expect(await screen.findByDisplayValue("codex-run-to-completion")).toBeTruthy();
    expect(await screen.findByDisplayValue("Codex Run To Completion")).toBeTruthy();
    expect(screen.queryByText(/\.git\/config/i)).toBeNull();
    expect(await screen.findByText(/Ignored 1 local metadata file/i)).toBeTruthy();
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
    const file = new File(["hello"], "SKILL.md", { type: "text/markdown" });
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /i have the rights to publish this skill under its declared or default clawhub license/i,
      }),
    );
    const publishButton = screen.getByRole("button", { name: /publish/i }) as HTMLButtonElement;
    await waitFor(() => {
      expect(publishButton.getAttribute("disabled")).toBeNull();
    });
    fireEvent.click(publishButton);
    expect(await screen.findByText(/Changelog is required/i)).toBeTruthy();
  });

  it("blocks publish in preflight when slug availability reports a collision", async () => {
    useQueryMock.mockImplementation((fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      const name = fn ? getFunctionName(fn as Parameters<typeof getFunctionName>[0]) : "";
      if (name === "publishers:listMine") {
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
    const file = new File(["hello"], "SKILL.md", { type: "text/markdown" });
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(
      (await screen.findAllByText(/Slug is already taken\. Choose a different slug\./i)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Taken")).toBeNull();
    expect(screen.getByLabelText("Slug unavailable")).toBeTruthy();
    const existingSkillLink = screen.getByRole("link", {
      name: "Open existing skill in a new tab",
    });
    expect(existingSkillLink).toBeTruthy();
    expect(existingSkillLink.getAttribute("href")).toBe("/alice/taken-skill");
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
            image: "https://example.com/clawkit.png",
          },
          role: "admin",
        },
      ];
    });

    render(<Upload />);
    fireEvent.change(screen.getByPlaceholderText("skill-name"), {
      target: { value: "org-skill" },
    });

    expect(screen.getByLabelText("Publishing as").textContent).toContain(
      "@clawkit · ClawKit · Admin",
    );
    expect(document.querySelector('img[src="https://example.com/clawkit.png"]')).toBeTruthy();
    expect(screen.queryByText("Available")).toBeNull();
    expect(await screen.findByLabelText("Slug available")).toBeTruthy();
    await waitFor(() => {
      expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), {
        slug: "org-skill",
        ownerHandle: "clawkit",
      });
    });
  });

  it("loads update metadata in the owner namespace when ownerHandle is present", async () => {
    useSearchMock.mockReturnValue({ updateSlug: "shared-skill", ownerHandle: "clawkit" });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args === undefined) {
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
      }
      if (
        args &&
        typeof args === "object" &&
        "slug" in (args as Record<string, unknown>) &&
        (args as Record<string, unknown>).slug === "shared-skill"
      ) {
        return {
          skill: { slug: "shared-skill", displayName: "Shared Skill" },
          latestVersion: { version: "1.2.3", clawScanNote: "safe network access" },
          owner: { handle: "clawkit", displayName: "ClawKit" },
        };
      }
      return null;
    });

    render(<Upload />);

    await waitFor(() => {
      expect(useQueryMock).toHaveBeenCalledWith(api.skills.getBySlug, {
        slug: "shared-skill",
        ownerHandle: "clawkit",
      });
    });
    expect(await screen.findByDisplayValue("Shared Skill")).toBeTruthy();
    expect(await screen.findByDisplayValue("1.2.4")).toBeTruthy();
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
      expect(screen.getByLabelText("Publishing as").textContent).toContain("@local");
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
      expect(screen.getByLabelText("Publishing as").textContent).toContain("@local-owner");
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

  it("does not render the skill icon picker or forward icon values to publishVersion", async () => {
    generateUploadUrl.mockResolvedValue("https://upload.local");
    publishVersion.mockResolvedValue(undefined);
    render(<Upload />);

    expect(screen.queryByRole("radio", { name: "No icon" })).toBeNull();
    expect(screen.queryByText(/^Icon$/)).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("skill-name"), {
      target: { value: "category-icon-skill" },
    });
    fireEvent.change(screen.getByPlaceholderText("My skill"), {
      target: { value: "Category Icon Skill" },
    });
    fireEvent.change(screen.getByPlaceholderText("1.0.0"), {
      target: { value: "1.0.0" },
    });
    fireEvent.change(screen.getByPlaceholderText("latest, stable"), {
      target: { value: "latest" },
    });

    const file = new File(["hello"], "SKILL.md", { type: "text/markdown" });
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /i have the rights to publish this skill under its declared or default clawhub license/i,
      }),
    );

    const publishButton = screen.getByRole("button", { name: /publish skill/i });
    await waitFor(() => {
      expect(publishButton.getAttribute("disabled")).toBeNull();
    });
    fireEvent.click(publishButton);

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
    expect(args).not.toBeUndefined();
    expect(Object.hasOwn(args!, "icon")).toBe(false);
  });

  it("keeps publish disabled after staged skill publish is accepted", async () => {
    generateUploadUrl.mockResolvedValue("https://upload.local");
    publishVersion.mockResolvedValueOnce({
      status: "pending",
      attemptId: "publishAttempts:1",
      slug: "pending-skill",
      version: "1.0.0",
    });
    render(<Upload />);

    fireEvent.change(screen.getByPlaceholderText("skill-name"), {
      target: { value: "pending-skill" },
    });
    fireEvent.change(screen.getByPlaceholderText("My skill"), {
      target: { value: "Pending Skill" },
    });
    fireEvent.change(screen.getByPlaceholderText("1.0.0"), {
      target: { value: "1.0.0" },
    });
    fireEvent.change(screen.getByPlaceholderText("latest, stable"), {
      target: { value: "latest" },
    });
    fireEvent.change(screen.getByTestId("upload-input"), {
      target: { files: [new File(["hello"], "SKILL.md", { type: "text/markdown" })] },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /i have the rights to publish this skill under its declared or default clawhub license/i,
      }),
    );

    const publishButton = screen.getByRole("button", { name: /publish skill/i });
    await waitFor(() => {
      expect(publishButton.getAttribute("disabled")).toBeNull();
    });
    fireEvent.click(publishButton);

    expect(
      await screen.findByText(/Running TruffleHog and ClawScan before public listing\./i),
    ).toBeTruthy();
    expect(publishButton.getAttribute("disabled")).not.toBeNull();
  });

  it("omits icon when republishing a skill that still has a stored legacy icon", async () => {
    useSearchMock.mockReturnValue({ updateSlug: "with-icon" });
    useQueryMock.mockImplementation((fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      const name = fn ? getFunctionName(fn as Parameters<typeof getFunctionName>[0]) : "";
      if (name === "skills:getBySlug") {
        return {
          skill: {
            slug: "with-icon",
            displayName: "With Icon",
            icon: "lucide:Plug",
          },
          latestVersion: { version: "1.0.0" },
          owner: { handle: "alice", displayName: "Alice" },
        };
      }
      // checkSlugAvailability + listMine + everything else stays default.
      return null;
    });
    generateUploadUrl.mockResolvedValue("https://upload.local");
    publishVersion.mockResolvedValue(undefined);

    render(<Upload />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("With Icon")).toBeTruthy();
    });
    expect(screen.queryByRole("radio", { name: "Plug" })).toBeNull();

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
        name: /i have the rights to publish this skill under its declared or default clawhub license/i,
      }),
    );

    const publishButton = screen.getByRole("button", { name: /publish skill/i });
    await waitFor(() => {
      expect(publishButton.getAttribute("disabled")).toBeNull();
    });
    fireEvent.click(publishButton);

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
    expect(args).not.toBeUndefined();
    expect(Object.hasOwn(args!, "icon")).toBe(false);
  });
});
