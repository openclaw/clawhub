/* @vitest-environment jsdom */
import type { Monaco } from "@monaco-editor/react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { SkillDiffCard, cssColor4ToHex } from "./SkillDiffCard";

const getFilePreviewMock = vi.fn();
const ensureMonacoLoaderMock = vi.fn();
let diffEditorMounts = 0;
let diffEditorUnmounts = 0;
// oxlint-disable-next-line typescript/no-redundant-type-constituents -- Monaco resolves to any via @monaco-editor/react types
let monacoInstanceMock: Monaco | null = null;

vi.mock("convex/react", () => ({
  useAction: () => getFilePreviewMock,
}));

vi.mock("../lib/monacoLoader", () => ({
  ensureMonacoLoader: () => ensureMonacoLoaderMock(),
}));

vi.mock("@monaco-editor/react", () => ({
  useMonaco: () => monacoInstanceMock,
}));

vi.mock("./SkillDiffEditor", () => ({
  SkillDiffEditor: ({
    className,
    options,
    original,
    modified,
  }: {
    className?: string;
    options?: { renderSideBySide?: boolean; useInlineViewWhenSpaceIsLimited?: boolean };
    original?: string;
    modified?: string;
  }) => (
    <MockDiffEditor
      className={className}
      options={options}
      original={original}
      modified={modified}
    />
  ),
}));

function MockDiffEditor({
  className,
  options,
  original,
  modified,
}: {
  className?: string;
  options?: { renderSideBySide?: boolean; useInlineViewWhenSpaceIsLimited?: boolean };
  original?: string;
  modified?: string;
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
      data-original={original}
      data-modified={modified}
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

function makeVersion(
  id: string,
  version: string,
  files = [{ path: "SKILL.md", size: 10, sha256: id }],
): Doc<"skillVersions"> {
  return {
    _id: id as Id<"skillVersions">,
    version,
    files,
  } as unknown as Doc<"skillVersions">;
}

const skill = {
  _id: "skills:1",
  slug: "diagram-tools",
  displayName: "Diagram Tools",
  tags: {},
  stats: { stars: 0, downloads: 0 },
} as unknown as Doc<"skills">;

function deferredPreview() {
  let resolve!: (value: { text: string | null }) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<{ text: string | null }>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function twoFileVersions() {
  return ["1", "2"].map((id) =>
    makeVersion(`skillVersions:${id}`, `1.0.${id}`, [
      { path: "SKILL.md", size: 10, sha256: `readme-${id}` },
      { path: "notes.txt", size: 10, sha256: `notes-${id}` },
    ]),
  );
}

describe("SkillDiffCard", () => {
  beforeEach(() => {
    getFilePreviewMock.mockReset();
    getFilePreviewMock.mockResolvedValue({ text: "content" });
    ensureMonacoLoaderMock.mockReset();
    ensureMonacoLoaderMock.mockResolvedValue(undefined);
    diffEditorMounts = 0;
    diffEditorUnmounts = 0;
    monacoInstanceMock = {
      editor: { defineTheme: vi.fn(), setTheme: vi.fn() },
    } as unknown as Monaco;
    document.documentElement.removeAttribute("data-theme-resolved");
    for (const property of ["--oc-bg-elevated", "--oc-text-primary", "--oc-text-secondary"]) {
      document.documentElement.style.removeProperty(property);
    }
  });

  it("does not mount an editor if the card closes before Monaco initialization completes", async () => {
    installMatchMedia(false);
    let finishLoading!: () => void;
    ensureMonacoLoaderMock.mockReturnValue(
      new Promise<void>((resolve) => {
        finishLoading = resolve;
      }),
    );
    monacoInstanceMock = null;
    const { unmount } = render(
      <SkillDiffCard
        skill={skill}
        versions={[makeVersion("left", "1.0.0"), makeVersion("right", "1.1.0")]}
      />,
    );
    expect(screen.getByRole("status", { name: "Loading diff" })).toBeTruthy();
    unmount();
    await act(async () => {
      finishLoading();
    });
    expect(diffEditorMounts).toBe(0);
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

  it("loads both sides concurrently and publishes the completed pair", async () => {
    installMatchMedia(false);
    const left = deferredPreview();
    const right = deferredPreview();
    getFilePreviewMock.mockImplementation(({ versionId }: { versionId: string }) =>
      versionId === "skillVersions:1" ? left.promise : right.promise,
    );

    render(<SkillDiffCard skill={skill} versions={twoFileVersions()} />);
    await waitFor(() => expect(getFilePreviewMock).toHaveBeenCalledTimes(2));
    await act(async () => left.resolve({ text: "before" }));
    expect(screen.queryByTestId("diff-editor")).toBeNull();
    expect(screen.getByRole("status", { name: "Loading diff" })).toBeTruthy();

    await act(async () => right.resolve({ text: "after" }));
    const editor = await screen.findByTestId("diff-editor");
    expect(editor.getAttribute("data-original")).toBe("before");
    expect(editor.getAttribute("data-modified")).toBe("after");

    fireEvent.click(screen.getByRole("button", { name: "Swap base and target versions" }));
    await waitFor(() => {
      expect(screen.getByTestId("diff-editor").getAttribute("data-original")).toBe("after");
      expect(screen.getByTestId("diff-editor").getAttribute("data-modified")).toBe("before");
    });
    expect(getFilePreviewMock).toHaveBeenCalledTimes(2);
  });

  it.each([null, "", "cached text"])(
    "caches a preview containing %j across file selection",
    async (text) => {
      installMatchMedia(false);
      getFilePreviewMock.mockImplementation(
        ({ path, versionId }: { path: string; versionId: string }) =>
          Promise.resolve({
            text: path === "SKILL.md" && versionId === "skillVersions:1" ? text : path,
          }),
      );
      render(<SkillDiffCard skill={skill} versions={twoFileVersions()} />);

      if (text === null) {
        await screen.findByText(/base file is download-only/i);
      } else {
        expect((await screen.findByTestId("diff-editor")).getAttribute("data-original")).toBe(text);
      }
      fireEvent.change(screen.getByRole("combobox", { name: "File" }), {
        target: { value: "notes.txt" },
      });
      await waitFor(() =>
        expect(screen.getByTestId("diff-editor").getAttribute("data-original")).toBe("notes.txt"),
      );
      fireEvent.change(screen.getByRole("combobox", { name: "File" }), {
        target: { value: "SKILL.md" },
      });
      if (text === null) {
        await screen.findByText(/base file is download-only/i);
        expect(screen.queryByTestId("diff-editor")).toBeNull();
      } else {
        await waitFor(() =>
          expect(screen.getByTestId("diff-editor").getAttribute("data-original")).toBe(text),
        );
      }
      expect(getFilePreviewMock).toHaveBeenCalledTimes(4);
    },
  );

  it("compares added and removed files against an empty absent side", async () => {
    installMatchMedia(false);
    getFilePreviewMock.mockImplementation(({ path }: { path: string }) =>
      Promise.resolve({ text: path }),
    );
    render(
      <SkillDiffCard
        skill={skill}
        versions={[
          makeVersion("skillVersions:1", "1.0.1", [
            { path: "removed.txt", size: 10, sha256: "old" },
          ]),
          makeVersion("skillVersions:2", "1.0.2", [{ path: "added.txt", size: 10, sha256: "new" }]),
        ]}
      />,
    );
    const added = await screen.findByTestId("diff-editor");
    expect(added.getAttribute("data-original")).toBe("");
    expect(added.getAttribute("data-modified")).toBe("added.txt");
    expect(getFilePreviewMock).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByRole("combobox", { name: "File" }), {
      target: { value: "removed.txt" },
    });
    await waitFor(() => {
      expect(screen.getByTestId("diff-editor").getAttribute("data-original")).toBe("removed.txt");
      expect(screen.getByTestId("diff-editor").getAttribute("data-modified")).toBe("");
    });
    expect(getFilePreviewMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    [204801, 10, "Left"],
    [10, 204801, "Right"],
    [204801, 204801, "Left"],
  ])(
    "rejects oversized files before either preview request (%s, %s)",
    async (leftSize, rightSize, side) => {
      installMatchMedia(false);
      render(
        <SkillDiffCard
          skill={skill}
          versions={[
            makeVersion("skillVersions:1", "1.0.1", [
              { path: "SKILL.md", size: leftSize, sha256: "old" },
            ]),
            makeVersion("skillVersions:2", "1.0.2", [
              { path: "SKILL.md", size: rightSize, sha256: "new" },
            ]),
          ]}
        />,
      );
      await screen.findByText(`${side} file exceeds 200KB: SKILL.md`);
      expect(getFilePreviewMock).not.toHaveBeenCalled();
      expect(screen.queryByTestId("diff-editor")).toBeNull();
    },
  );

  it("allows a file exactly at the diff size limit", async () => {
    installMatchMedia(false);
    const versions = twoFileVersions();
    versions[0].files[0].size = 204800;
    versions[1].files[0].size = 204800;
    render(<SkillDiffCard skill={skill} versions={versions} />);
    await screen.findByTestId("diff-editor");
    expect(getFilePreviewMock).toHaveBeenCalledTimes(2);
  });

  it.each(["right", "both"])(
    "keeps download-only warning precedence with %s binary sides",
    async (side) => {
      installMatchMedia(false);
      getFilePreviewMock.mockImplementation(({ versionId }: { versionId: string }) =>
        Promise.resolve({
          text: side === "both" || versionId === "skillVersions:2" ? null : "text",
        }),
      );
      render(<SkillDiffCard skill={skill} versions={twoFileVersions()} />);
      await screen.findByText(
        new RegExp(`${side === "both" ? "base" : "target"} file is download-only`, "i"),
      );
      expect(screen.queryByTestId("diff-editor")).toBeNull();
    },
  );

  it.each([new Error("preview unavailable"), "failed"])(
    "recovers after a rejected preview without caching the failure",
    async (error) => {
      installMatchMedia(false);
      getFilePreviewMock.mockImplementationOnce(() => Promise.reject(error));
      render(<SkillDiffCard skill={skill} versions={twoFileVersions()} />);
      await screen.findByText(error instanceof Error ? error.message : "Failed to load diff");
      expect(screen.queryByTestId("diff-editor")).toBeNull();

      fireEvent.change(screen.getByRole("combobox", { name: "File" }), {
        target: { value: "notes.txt" },
      });
      await screen.findByTestId("diff-editor");
      fireEvent.change(screen.getByRole("combobox", { name: "File" }), {
        target: { value: "SKILL.md" },
      });
      await screen.findByTestId("diff-editor");
      expect(getFilePreviewMock).toHaveBeenCalledTimes(5);
    },
  );

  it.each(["resolve", "reject"])(
    "ignores a cancelled preview that later %ss while retaining successful cache entries",
    async (settlement) => {
      installMatchMedia(false);
      const left = deferredPreview();
      const right = deferredPreview();
      getFilePreviewMock.mockImplementation(
        ({ path, versionId }: { path: string; versionId: string }) => {
          if (path === "SKILL.md")
            return versionId === "skillVersions:1" ? left.promise : right.promise;
          return Promise.resolve({ text: "current notes" });
        },
      );
      render(<SkillDiffCard skill={skill} versions={twoFileVersions()} />);
      await waitFor(() => expect(getFilePreviewMock).toHaveBeenCalledTimes(2));
      fireEvent.change(screen.getByRole("combobox", { name: "File" }), {
        target: { value: "notes.txt" },
      });
      await screen.findByTestId("diff-editor");

      await act(async () => {
        left.resolve({ text: "late base" });
        if (settlement === "resolve") right.resolve({ text: "late target" });
        else right.reject(new Error("late error"));
      });
      expect(screen.getByTestId("diff-editor").getAttribute("data-original")).toBe("current notes");
      expect(screen.getByTestId("diff-editor").getAttribute("data-modified")).toBe("current notes");
      expect(screen.queryByText("late error")).toBeNull();

      getFilePreviewMock.mockResolvedValue({ text: "retried target" });
      fireEvent.change(screen.getByRole("combobox", { name: "File" }), {
        target: { value: "SKILL.md" },
      });
      await waitFor(() => {
        expect(screen.getByTestId("diff-editor").getAttribute("data-original")).toBe("late base");
        expect(screen.getByTestId("diff-editor").getAttribute("data-modified")).toBe(
          settlement === "resolve" ? "late target" : "retried target",
        );
      });
      expect(getFilePreviewMock).toHaveBeenCalledTimes(settlement === "resolve" ? 4 : 5);
    },
  );

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
