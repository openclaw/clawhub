import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { SkillFilesPanel } from "./SkillFilesPanel";

const getFileTextMock = vi.fn();

vi.mock("convex/react", () => ({
  useAction: () => getFileTextMock,
}));

type SkillFile = Doc<"skillVersions">["files"][number];

function makeFile(path: string, size: number): SkillFile {
  return { path, size } as unknown as SkillFile;
}

describe("SkillFilesPanel", () => {
  beforeEach(() => {
    getFileTextMock.mockReset();
    getFileTextMock.mockResolvedValue({
      text: "",
      size: 0,
      sha256: "0".repeat(64),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("caches loaded files and avoids duplicate fetches", async () => {
    getFileTextMock.mockResolvedValue({
      text: "echo hello",
      size: 10,
      sha256: "a".repeat(64),
    });

    render(
      <SkillFilesPanel
        versionId={"skillVersions:1" as Id<"skillVersions">}
        latestFiles={[makeFile("scripts/run.sh", 10)]}
      />,
    );

    const fileButton = screen.getByRole("button", { name: /scripts\/run\.sh/i });
    fireEvent.click(fileButton);

    await screen.findByText("echo hello");

    fireEvent.click(fileButton);

    await waitFor(() => {
      expect(getFileTextMock).toHaveBeenCalledTimes(1);
    });
  });

  it("ignores stale responses when newer file selection is active", async () => {
    const resolvers: Record<
      string,
      (value: { text: string; size: number; sha256: string }) => void
    > = {};

    getFileTextMock.mockImplementation(
      ({ path }: { path: string }) =>
        new Promise<{ text: string; size: number; sha256: string }>((resolve) => {
          resolvers[path] = resolve;
        }),
    );

    render(
      <SkillFilesPanel
        versionId={"skillVersions:1" as Id<"skillVersions">}
        latestFiles={[makeFile("a.txt", 5), makeFile("b.txt", 6)]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /a\.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: "Back to file list" }));
    fireEvent.click(screen.getByRole("button", { name: /b\.txt/i }));

    resolvers["a.txt"]({ text: "alpha", size: 5, sha256: "b".repeat(64) });
    resolvers["b.txt"]({ text: "beta", size: 6, sha256: "c".repeat(64) });

    await screen.findByText("beta");
    expect(screen.queryByText("alpha")).toBeNull();
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
      <SkillFilesPanel versionId={"skillVersions:1" as Id<"skillVersions">} latestFiles={files} />,
    );

    expect(screen.getByRole("button", { name: /folder\/file-10\.md/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "See all" })).toBeNull();
  });
});
