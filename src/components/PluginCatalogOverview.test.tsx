/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { fetchPackageFile, PackageApiError } from "../lib/packageApi";
import { PluginCatalogOverview } from "./PluginCatalogOverview";

vi.mock("../lib/packageApi", async (importActual) => ({
  ...(await importActual<typeof import("../lib/packageApi")>()),
  fetchPackageFile: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const skill = {
  name: "wacli",
  description: "Send third-party WhatsApp messages. Not for normal active chats.",
  rootPath: "skills/wacli",
  skillMdPath: "skills/wacli/SKILL.md",
  sha256: "a".repeat(64),
  size: 256,
};
function overview(description: string | undefined = skill.description, publisherHandle?: string) {
  render(
    <PluginCatalogOverview
      manifest={{
        schemaVersion: 1,
        configFields: [],
        mcpServers: [],
        bundledSkills: [{ ...skill, description }],
      }}
      packageName="@openclaw/whatsapp"
      version="2026.11.8"
      readme={null}
      publisherHandle={publisherHandle}
    />,
  );
  return screen.getByRole("button", { name: "Preview wacli" });
}

it("opens the bundled reader with catalog identity, not file metadata, above the original document", async () => {
  vi.mocked(fetchPackageFile).mockResolvedValueOnce(
    [
      "\uFEFF---",
      "name: wacli",
      "homepage: https://wacli.sh",
      "---",
      "# wacli",
      "",
      "Safety",
      "",
      "- Require explicit recipient + message text.",
      "",
      "Auth + sync",
      "",
      "- `wacli doctor`",
    ].join("\r\n"),
  );
  const row = overview(skill.description, "openclaw");
  expect(fetchPackageFile).not.toHaveBeenCalled();
  fireEvent.click(row);
  const dialog = screen.getByRole("dialog", { name: "wacli" });
  const reader = within(dialog);
  expect(reader.getByRole("heading", { level: 2, name: "wacli" })).toBeTruthy();
  expect(reader.getByText("@openclaw")).toBeTruthy();
  expect(reader.getByText("Send third-party WhatsApp messages.")).toBeTruthy();
  expect(dialog.textContent).not.toContain("Not for normal active chats.");
  expect(dialog.textContent).not.toContain(skill.skillMdPath);
  const article = within(await reader.findByRole("article"));
  expect(article.getByRole("heading", { level: 1, name: "wacli" })).toBeTruthy();
  expect(article.getByText("Safety", { selector: "p" })).toBeTruthy();
  expect(article.getByText("Require explicit recipient + message text.")).toBeTruthy();
  expect(article.getByText("wacli doctor", { selector: "code" })).toBeTruthy();
  expect(dialog.textContent).not.toContain("homepage:");
  expect(reader.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
    "Close",
  ]);
  fireEvent.click(reader.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(document.activeElement).toBe(row));
});

it("retires a dismissed read and restores keyboard focus even while loading", async () => {
  let finish!: (content: string) => void;
  vi.mocked(fetchPackageFile)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValueOnce("New read");
  const row = overview("   ");
  row.focus();
  fireEvent.click(row);
  const loading = within(screen.getByRole("dialog", { name: "wacli" }));
  expect(loading.getByRole("status", { name: "Loading…" })).toBeTruthy();
  expect(loading.queryByText(/^@/)).toBeNull();
  expect(loading.queryByRole("paragraph")).toBeNull();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(row));
  fireEvent.click(row);
  await screen.findByText("New read");
  await act(async () => finish("Old read"));
  expect(screen.queryByText("Old read")).toBeNull();
});

it("offers Retry only after a failed read, against the originally selected release", async () => {
  vi.mocked(fetchPackageFile)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(
      [
        "[Relative guide](./notes.md)",
        "",
        "![Diagram](https://example.org/diagram.png)",
        "",
        "~~~sh",
        "wacli doctor",
        "~~~",
      ].join("\n"),
    );
  fireEvent.click(overview());
  const dialog = within(screen.getByRole("dialog", { name: "wacli" }));
  expect((await dialog.findByRole("alert")).textContent).toBe("Couldn’t read SKILL.md.");
  fireEvent.click(dialog.getByRole("button", { name: "Retry" }));
  const article = within(await dialog.findByRole("article"));
  expect(article.getByText("Relative guide")).toBeTruthy();
  expect(article.queryByRole("link", { name: "Relative guide" })).toBeNull();
  expect(article.queryByRole("img")).toBeNull();
  expect(article.getByRole("link", { name: "Open image" }).getAttribute("href")).toBe(
    "https://example.org/diagram.png",
  );
  expect(article.getByText("wacli doctor", { selector: "pre code" })).toBeTruthy();
  expect(article.queryByRole("button")).toBeNull();
  expect(dialog.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(vi.mocked(fetchPackageFile).mock.calls).toEqual([
    ["@openclaw/whatsapp", "skills/wacli/SKILL.md", "2026.11.8"],
    ["@openclaw/whatsapp", "skills/wacli/SKILL.md", "2026.11.8"],
  ]);
});

it("does not pass an unterminated metadata envelope off as instructions", async () => {
  vi.mocked(fetchPackageFile).mockResolvedValueOnce(
    "---\nname: wacli\nmetadata:\n  requires: [wacli]\n",
  );
  fireEvent.click(overview());
  const dialog = within(screen.getByRole("dialog", { name: "wacli" }));
  expect((await dialog.findByRole("alert")).textContent).toBe("Couldn’t read SKILL.md.");
  expect(dialog.queryByRole("article")).toBeNull();
  expect(dialog.queryByRole("button", { name: "Retry" })).toBeNull();
});

it("explains the size limit without offering a retry that cannot help", async () => {
  vi.mocked(fetchPackageFile).mockRejectedValueOnce(
    new PackageApiError("File too large", { status: 413 }),
  );
  fireEvent.click(overview());
  const dialog = within(screen.getByRole("dialog", { name: "wacli" }));
  expect((await dialog.findByRole("alert")).textContent).toBe("SKILL.md is too large to preview.");
  expect(dialog.queryByRole("button", { name: "Retry" })).toBeNull();
});
