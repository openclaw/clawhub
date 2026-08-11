/* @vitest-environment jsdom */
import type { Monaco } from "@monaco-editor/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { SkillDiffCard, cssColor4ToHex } from "./SkillDiffCard";

const getFilePreviewMock = vi.fn();
let diffEditorMounts = 0;
let diffEditorUnmounts = 0;
// oxlint-disable-next-line typescript/no-redundant-type-constituents -- Monaco resolves to any via @monaco-editor/react types
let monacoInstanceMock: Monaco | null = null;

vi.mock("convex/react", () => ({
  useAction: () => getFilePreviewMock,
}));

vi.mock("../lib/monacoLoader", () => ({
  ensureMonacoLoader: () => Promise.resolve(),
}));

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: ({
    className,
    options,
  }: {
    className?: string;
    options?: { renderSideBySide?: boolean; useInlineViewWhenSpaceIsLimited?: boolean };
  }) => <MockDiffEditor className={className} options={options} />,
  useMonaco: () => monacoInstanceMock,
}));

function MockDiffEditor({
  className,
  options,
}: {
  className?: string;
  options?: { renderSideBySide?: boolean; useInlineViewWhenSpaceIsLimited?: boolean };
}) {
  useEffect(() => {
    diffEditorMounts += 1;
    return () => {
      diffEditorUnmounts += 1;
    };
  }, []);

  return (
    <div
      className={className}
      data-inline-fallback={String(options?.useInlineViewWhenSpaceIsLimited)}
      data-side-by-side={String(options?.renderSideBySide)}
      data-testid="diff-editor"
    />
  );
}

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
    getFilePreviewMock.mockReset();
    getFilePreviewMock.mockResolvedValue({ text: "content" });
    diffEditorMounts = 0;
    diffEditorUnmounts = 0;
    monacoInstanceMock = null;
    document.documentElement.removeAttribute("data-theme-resolved");
    for (const property of ["--oc-bg-elevated", "--oc-text-primary", "--oc-text-secondary"]) {
      document.documentElement.style.removeProperty(property);
    }
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
    expect(screen.getByRole("button", { name: "Inline" }).className).toContain("is-active");
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
    expect(screen.getByRole("button", { name: "Side-by-side" }).className).toContain("is-active");
  });

  it("keeps the diff editor mounted when toggling view mode", async () => {
    installMatchMedia(false);

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
      expect(screen.getByTestId("diff-editor")).toBeTruthy();
      expect(diffEditorMounts).toBe(1);
    });

    expect(diffEditorUnmounts).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Inline" }));

    await waitFor(() => {
      expect(screen.getByTestId("diff-editor").getAttribute("data-side-by-side")).toBe("false");
    });

    expect(diffEditorMounts).toBe(1);
    expect(diffEditorUnmounts).toBe(0);
  });

  it("shows a download-only state when either file cannot be previewed as text", async () => {
    installMatchMedia(false);
    getFilePreviewMock.mockImplementation(({ versionId }: { versionId: string }) =>
      Promise.resolve({
        text: versionId === "skillVersions:1" ? null : "<svg>changed</svg>",
      }),
    );

    const leftVersion = makeVersion("skillVersions:1", "1.0.1");
    const rightVersion = makeVersion("skillVersions:2", "1.0.2");
    leftVersion.files = [{ path: "diagram.svg", size: 18 }] as typeof leftVersion.files;
    rightVersion.files = [{ path: "diagram.svg", size: 22 }] as typeof rightVersion.files;

    render(<SkillDiffCard skill={skill} versions={[leftVersion, rightVersion]} />);

    expect(
      await screen.findByText(/base file is download-only and cannot be compared as text/i),
    ).toBeTruthy();
    expect(screen.queryByTestId("diff-editor")).toBeNull();
  });

  it("passes only Monaco-safe colors to defineTheme when tokens use CSS Color 4", async () => {
    installMatchMedia(false);
    // Sanity guard: if jsdom stops resolving custom properties through
    // getComputedStyle, this test must fail loudly instead of asserting fallbacks.
    document.documentElement.style.setProperty("--oc-bg-elevated", "oklch(0.205 0 0)");
    document.documentElement.style.setProperty("--oc-text-primary", "oklch(0.985 0 0)");
    document.documentElement.style.setProperty("--oc-text-secondary", "lab(98.26% 0 0)");
    expect(getComputedStyle(document.documentElement).getPropertyValue("--oc-text-primary")).toBe(
      "oklch(0.985 0 0)",
    );

    const defineTheme = vi.fn();
    monacoInstanceMock = {
      editor: { defineTheme, setTheme: vi.fn() },
    } as unknown as Monaco;

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
      expect(defineTheme).toHaveBeenCalled();
    });
    const themeData = defineTheme.mock.calls[0][1] as {
      rules: { foreground: string }[];
      colors: Record<string, string>;
    };
    for (const rule of themeData.rules) {
      expect(rule.foreground).toMatch(/^#[0-9a-f]{6,8}$/i);
    }
    expect(themeData.rules[0].foreground).toBe("#fafafa");
    expect(themeData.rules[1].foreground).toBe("#fafafa");
    expect(themeData.colors["editor.background"]).toBe("#171717");
    expect(themeData.colors["editor.foreground"]).toBe("#fafafa");
  });

  it("falls back to theme-safe colors when a token uses syntax Monaco cannot parse", async () => {
    installMatchMedia(false);
    document.documentElement.dataset.themeResolved = "dark";
    document.documentElement.style.setProperty("--oc-text-primary", "color(display-p3 1 1 1)");

    const defineTheme = vi.fn();
    monacoInstanceMock = {
      editor: { defineTheme, setTheme: vi.fn() },
    } as unknown as Monaco;

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
      expect(defineTheme).toHaveBeenCalled();
    });
    const themeData = defineTheme.mock.calls[0][1] as {
      rules: { foreground: string }[];
    };
    expect(themeData.rules[0].foreground).toBe("#fafafa");
  });
});

describe("cssColor4ToHex", () => {
  // Expected values computed independently from the CSS Color 4 conversion
  // matrices (Ottosson's OKLab; CIE Lab with D50 white and Bradford adaptation).
  it.each([
    ["oklch(0.985 0 0)", "#fafafa"],
    ["oklab(0.985 0 0)", "#fafafa"],
    ["lab(98.26% 0 0)", "#fafafa"],
    ["lch(98.26% 0 0)", "#fafafa"],
    ["lab(0% 0 0)", "#000000"],
    ["oklch(1 0 0)", "#ffffff"],
    ["oklch(0.7 0.15 180)", "#00bca2"],
    ["oklch(0.6 0.2 30)", "#de3e2d"],
    ["lab(60% 40 -30)", "#c175c7"],
    ["lch(60% 50 250)", "#009ce3"],
    ["oklch(0.87 0 0)", "#d4d4d4"],
    ["oklch(0.205 0 0)", "#171717"],
    ["lab(50% 20% -20%)", "#9168a2"],
  ])("converts %s to %s", (input, expected) => {
    expect(cssColor4ToHex(input)).toBe(expected);
  });

  it("keeps an alpha channel as a fourth hex pair", () => {
    expect(cssColor4ToHex("oklch(0 0 0 / 0.3)")).toBe("#0000004d");
    expect(cssColor4ToHex("oklch(0 0 0 / 30%)")).toBe("#0000004d");
  });

  it("returns null for syntaxes it does not convert", () => {
    expect(cssColor4ToHex("color(display-p3 1 0 0)")).toBeNull();
    expect(cssColor4ToHex("hsl(120 50% 50%)")).toBeNull();
    expect(cssColor4ToHex("oklch(0.5 0.1 0.5turn)")).toBeNull();
    expect(cssColor4ToHex("rebeccapurple")).toBeNull();
  });
});
