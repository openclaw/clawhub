/* @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { SkillDiffCard } from "./SkillDiffCard";

const getFileTextMock = vi.fn();

vi.mock("convex/react", () => ({
  useAction: () => getFileTextMock,
}));

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: ({
    className,
    options,
  }: {
    className?: string;
    options?: { renderSideBySide?: boolean; useInlineViewWhenSpaceIsLimited?: boolean };
  }) => (
    <div
      className={className}
      data-inline-fallback={String(options?.useInlineViewWhenSpaceIsLimited)}
      data-side-by-side={String(options?.renderSideBySide)}
      data-testid="diff-editor"
    />
  ),
  useMonaco: () => null,
}));

function installMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: "(max-width: 860px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function makeVersion(id: string, version: string): Doc<"skillVersions"> {
  return {
    _id: id as Id<"skillVersions">,
    version,
    files: [{ path: "SKILL.md", size: 10 }],
  } as unknown as Doc<"skillVersions">;
}

const skill = {
  _id: "skills:1",
  slug: "diagram-tools",
  displayName: "Diagram Tools",
  tags: {},
  stats: { stars: 0, downloads: 0 },
} as unknown as Doc<"skills">;

describe("SkillDiffCard", () => {
  beforeEach(() => {
    getFileTextMock.mockReset();
    getFileTextMock.mockResolvedValue({ text: "content" });
  });

  it("defaults to inline mode on narrow screens", async () => {
    installMatchMedia(true);

    render(
      <SkillDiffCard
        skill={skill}
        versions={[
          makeVersion("skillVersions:1", "1.0.1"),
          makeVersion("skillVersions:2", "1.0.2"),
        ]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("diff-editor").getAttribute("data-side-by-side")).toBe("false");
    });
    expect(screen.getByRole("button", { name: "Inline" }).className).toContain("shadow-sm");
    expect(screen.getByTestId("diff-editor").getAttribute("data-inline-fallback")).toBe("false");
  });

  it("keeps explicit split mode when selected on narrow screens", async () => {
    installMatchMedia(true);

    render(
      <SkillDiffCard
        skill={skill}
        versions={[
          makeVersion("skillVersions:1", "1.0.1"),
          makeVersion("skillVersions:2", "1.0.2"),
        ]}
      />,
    );

    await screen.findByTestId("diff-editor");
    fireEvent.click(screen.getByRole("button", { name: "Side-by-side" }));

    await waitFor(() => {
      expect(screen.getByTestId("diff-editor").getAttribute("data-side-by-side")).toBe("true");
    });
    expect(screen.getByRole("button", { name: "Side-by-side" }).className).toContain("shadow-sm");
  });
});
