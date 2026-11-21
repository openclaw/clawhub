import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { SkillFilesPanel } from "./SkillFilesPanel";

const getFilePreviewMock = vi.fn();

vi.mock("convex/react", () => ({
  useAction: () => getFilePreviewMock,
}));

type SkillFile = Doc<"skillVersions">["files"][number];

function makeFile(path: string, size: number): SkillFile {
  return { path, size } as unknown as SkillFile;
}

describe("SkillFilesPanel", () => {
  beforeEach(() => {
    getFilePreviewMock.mockReset();
    getFilePreviewMock.mockResolvedValue({
      text: "",
      size: 0,
      sha256: "0".repeat(64),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("caches loaded files and avoids duplicate fetches", async () => {
    getFilePreviewMock.mockResolvedValue({
      text: "echo hello",
      size: 10,
      sha256: "a".repeat(64),
    });

    render(
      <SkillFilesPanel
        versionId={"skillVersions:1" as Id<"skillVersions">}
        version={null}
        latestFiles={[makeFile("scripts/run.sh", 10)]}
        skillSlug="demo"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /scripts\/run\.sh/i }));

    await screen.findByText("echo hello");

    fireEvent.click(screen.getByRole("button", { name: "Back to file list" }));
    fireEvent.click(screen.getByRole("button", { name: /scripts\/run\.sh/i }));
    await screen.findByText("echo hello");

    await waitFor(() => {
      expect(getFilePreviewMock).toHaveBeenCalledTimes(1);
    });
  });

  it("shows a loading skeleton while fetching uncached file content", () => {
    getFilePreviewMock.mockImplementation(
      () =>
        new Promise<{
          text: string | null;
          size: number;
          sha256: string;
        }>(() => {
          /* never resolves */
        }),
    );

    const { container } = render(
      <SkillFilesPanel
        versionId={"skillVersions:1" as Id<"skillVersions">}
        version={null}
        latestFiles={[makeFile("scripts/run.sh", 10)]}
        skillSlug="demo"
      />,
    );

    Object.defineProperty(container.querySelector(".file-list"), "offsetHeight", { value: 280 });

    fireEvent.click(screen.getByRole("button", { name: /scripts\/run\.sh/i }));

    expect(container.querySelector(".file-viewer.is-loading")).not.toBeNull();
    expect(container.querySelector<HTMLElement>(".file-viewer")?.style.minHeight).toBe("280px");
    expect(container.querySelector(".file-viewer-skeleton")).not.toBeNull();
    expect(screen.getByRole("status", { name: "Loading file" })).toBeTruthy();
  });

  it("clears the loading min-height after file content resolves", async () => {
    getFilePreviewMock.mockResolvedValue({
      text: "echo hello",
      size: 10,
      sha256: "a".repeat(64),
    });

    const { container } = render(
      <SkillFilesPanel
        versionId={"skillVersions:1" as Id<"skillVersions">}
        version={null}
        latestFiles={[makeFile("scripts/run.sh", 10)]}
        skillSlug="demo"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /scripts\/run\.sh/i }));
    await screen.findByText("echo hello");

    expect(container.querySelector(".file-viewer.is-loading")).toBeNull();
    expect(container.querySelector(".file-viewer")?.getAttribute("style")).toBeNull();
  });

  it("renders an empty file after it loads", async () => {
    const { container } = render(
      <SkillFilesPanel
        versionId={"skillVersions:1" as Id<"skillVersions">}
        version={null}
        latestFiles={[makeFile("empty.txt", 0)]}
        skillSlug="demo"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /empty\.txt/i }));

    await waitFor(() => {
      expect(container.querySelector("pre.file-viewer-code")).not.toBeNull();
    });
    expect(container.querySelector("pre.file-viewer-code")?.textContent).toBe("");
  });

  it("offers opaque files as download-only and caches the result", async () => {
    getFilePreviewMock.mockResolvedValue({
      text: null,
      size: 4,
      sha256: "d".repeat(64),
    });

    render(
      <SkillFilesPanel
        versionId={"skillVersions:1" as Id<"skillVersions">}
        version="1.2.3"
        latestFiles={[makeFile("assets/payload.bin", 4)]}
        skillSlug="demo"
        ownerHandle="acme"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /assets\/payload\.bin/i }));

    await screen.findByText(/available to download but cannot be previewed as text/i);
    expect(screen.getByRole("link", { name: "Download payload.bin" }).getAttribute("href")).toBe(
      "/api/v1/skills/demo/file?path=assets%2Fpayload.bin&ownerHandle=acme&version=1.2.3",
    );

    fireEvent.click(screen.getByRole("button", { name: "Back to file list" }));
    fireEvent.click(screen.getByRole("button", { name: /assets\/payload\.bin/i }));
    await screen.findByText(/available to download but cannot be previewed as text/i);
    expect(getFilePreviewMock).toHaveBeenCalledTimes(1);
  });

  it("encodes URL syntax in literal artifact download paths", async () => {
    getFilePreviewMock.mockResolvedValue({
      text: null,
      size: 4,
      sha256: "d".repeat(64),
    });

    render(
      <SkillFilesPanel
        versionId={"skillVersions:1" as Id<"skillVersions">}
        version="1.2.3"
        latestFiles={[makeFile("docs/spec#draft?.bin", 4)]}
        skillSlug="demo"
        ownerHandle="acme"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /docs\/spec#draft\?\.bin/i }));

    const downloadLink = await screen.findByRole("link", { name: "Download spec#draft?.bin" });
    expect(downloadLink.getAttribute("href")).toBe(
      "/api/v1/skills/demo/file?path=docs%2Fspec%23draft%3F.bin&ownerHandle=acme&version=1.2.3",
    );
  });

  it("ignores stale responses when newer file selection is active", async () => {
    const resolvers: Record<
      string,
      (value: { text: string | null; size: number; sha256: string }) => void
    > = {};

    getFilePreviewMock.mockImplementation(
      ({ path }: { path: string }) =>
        new Promise<{
          text: string | null;
          size: number;
          sha256: string;
        }>((resolve) => {
          resolvers[path] = resolve;
        }),
    );

    render(
      <SkillFilesPanel
        versionId={"skillVersions:1" as Id<"skillVersions">}
        version={null}
        latestFiles={[makeFile("a.txt", 5), makeFile("b.txt", 6)]}
        skillSlug="demo"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /a\.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: "Back to file list" }));
    fireEvent.click(screen.getByRole("button", { name: /b\.txt/i }));

    resolvers["a.txt"]({
      text: "alpha",
      size: 5,
      sha256: "b".repeat(64),
    });
    resolvers["b.txt"]({
      text: "beta",
      size: 6,
      sha256: "c".repeat(64),
    });

    await screen.findByText("beta");
    expect(screen.queryByText("alpha")).toBeNull();
  });

  it("retries a failed preview after returning to the file list", async () => {
    getFilePreviewMock
      .mockRejectedValueOnce(new Error("Preview unavailable"))
      .mockResolvedValueOnce({ text: "recovered", size: 9, sha256: "e".repeat(64) });
    const { container } = render(
      <SkillFilesPanel
        versionId={"skillVersions:1" as Id<"skillVersions">}
        version="1.0.0"
        latestFiles={[makeFile("retry.txt", 9)]}
        skillSlug="demo"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /retry\.txt/i }));
    await screen.findByText("Failed to load file: Preview unavailable");
    expect(container.querySelector(".file-viewer")?.getAttribute("style")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to file list" }));
    fireEvent.click(screen.getByRole("button", { name: /retry\.txt/i }));
    await screen.findByText("recovered");
    expect(getFilePreviewMock).toHaveBeenCalledTimes(2);
  });

  it.each(["resolve", "reject"] as const)(
    "ignores a pending preview that %ss after Back without caching it",
    async (settlement) => {
      let resolve!: (value: { text: string; size: number; sha256: string }) => void;
      let reject!: (error: Error) => void;
      getFilePreviewMock.mockReturnValueOnce(
        new Promise((resolvePromise, rejectPromise) => {
          resolve = resolvePromise;
          reject = rejectPromise;
        }),
      );
      render(
        <SkillFilesPanel
          versionId={"skillVersions:1" as Id<"skillVersions">}
          version="1.0.0"
          latestFiles={[makeFile("pending.txt", 5)]}
          skillSlug="demo"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /pending\.txt/i }));
      fireEvent.click(screen.getByRole("button", { name: "Back to file list" }));
      await act(async () => {
        if (settlement === "resolve") resolve({ text: "stale", size: 5, sha256: "f".repeat(64) });
        else reject(new Error("Stale failure"));
      });
      expect(screen.queryByText("stale")).toBeNull();
      expect(screen.queryByText(/Stale failure/)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /pending\.txt/i }));
      await waitFor(() => expect(getFilePreviewMock).toHaveBeenCalledTimes(2));
    },
  );

  it.each(["resolve", "reject"] as const)(
    "isolates version caches when an earlier preview %ss late",
    async (settlement) => {
      let resolve!: (value: { text: string; size: number; sha256: string }) => void;
      let reject!: (error: Error) => void;
      getFilePreviewMock
        .mockReturnValueOnce(
          new Promise((resolvePromise, rejectPromise) => {
            resolve = resolvePromise;
            reject = rejectPromise;
          }),
        )
        .mockResolvedValue({ text: "current", size: 7, sha256: "a".repeat(64) });
      const props = { latestFiles: [makeFile("shared.txt", 7)], skillSlug: "demo" };
      const { rerender } = render(
        <SkillFilesPanel
          {...props}
          versionId={"skillVersions:1" as Id<"skillVersions">}
          version="1.0.0"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /shared\.txt/i }));
      rerender(
        <SkillFilesPanel
          {...props}
          versionId={"skillVersions:2" as Id<"skillVersions">}
          version="2.0.0"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /shared\.txt/i }));
      await screen.findByText("current");
      await act(async () => {
        if (settlement === "resolve") resolve({ text: "stale", size: 5, sha256: "f".repeat(64) });
        else reject(new Error("Stale failure"));
      });
      expect(screen.queryByText("stale")).toBeNull();
      expect(screen.queryByText(/Stale failure/)).toBeNull();
      expect(screen.getByText("current")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Back to file list" }));
      fireEvent.click(screen.getByRole("button", { name: /shared\.txt/i }));
      await screen.findByText("current");
      expect(getFilePreviewMock).toHaveBeenCalledTimes(2);
      rerender(
        <SkillFilesPanel
          {...props}
          versionId={"skillVersions:1" as Id<"skillVersions">}
          version="1.0.0"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /shared\.txt/i }));
      await waitFor(() => expect(getFilePreviewMock).toHaveBeenCalledTimes(3));
      expect(getFilePreviewMock).toHaveBeenLastCalledWith({
        versionId: "skillVersions:1",
        path: "shared.txt",
      });
    },
  );

  it("resets line wrapping when opening different file content", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(500);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
    getFilePreviewMock
      .mockResolvedValueOnce({ text: "first content", size: 13, sha256: "a".repeat(64) })
      .mockResolvedValueOnce({ text: "second content", size: 14, sha256: "b".repeat(64) });
    const { container } = render(
      <SkillFilesPanel
        versionId={"skillVersions:1" as Id<"skillVersions">}
        version="1.0.0"
        latestFiles={[makeFile("first.txt", 13), makeFile("second.txt", 14)]}
        skillSlug="demo"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /first\.txt/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Enable line wrap" }));
    expect(container.querySelector("pre")?.getAttribute("data-wrap")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Back to file list" }));
    fireEvent.click(screen.getByRole("button", { name: /second\.txt/i }));
    await screen.findByText("second content");
    expect(container.querySelector("pre")?.getAttribute("data-wrap")).toBe("false");
  });

  it("shows the complete file tree on mobile", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width: 899px"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const files = Array.from({ length: 10 }, (_, index) =>
      makeFile(`folder/file-${index + 1}.md`, index + 1),
    );
    render(
      <SkillFilesPanel
        versionId={"skillVersions:1" as Id<"skillVersions">}
        version={null}
        latestFiles={files}
        skillSlug="demo"
      />,
    );

    expect(screen.getByRole("button", { name: /folder\/file-10\.md/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "See all" })).toBeNull();
  });
});
