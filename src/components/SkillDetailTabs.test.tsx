/* @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ClawdisSkillMetadata } from "clawhub-schema";
import { useState, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc } from "../../convex/_generated/dataModel";
import { buildSkillDetailTabs, skillTabFromHash, type DetailTab } from "../lib/skillDetailTabs";
import { SkillDetailTabs } from "./SkillDetailTabs";

type TestProps = Partial<
  Omit<ComponentProps<typeof SkillDetailTabs>, "tabs" | "setActiveTab" | "activeTab">
>;

function TestTabs({ initialTab = "readme", ...overrides }: TestProps & { initialTab?: DetailTab }) {
  const [activeTab, setActiveTab] = useState<DetailTab>(initialTab);
  const props = {
    readmeContent: "# API Gateway",
    readmeError: null,
    skill: { slug: "api-gateway" } as Doc<"skills">,
    clawdis: undefined,
    osLabels: [],
    ...overrides,
  };
  const tabs = buildSkillDetailTabs({
    hasEvaluation: Boolean(props.evaluationContent),
    clawdis: props.clawdis,
    osLabels: props.osLabels,
  });
  return (
    <SkillDetailTabs {...props} tabs={tabs} activeTab={activeTab} setActiveTab={setActiveTab} />
  );
}

describe("SkillDetailTabs README", () => {
  it("renders the publisher's SKILL.md as the only tab when no additional content exists", () => {
    render(<TestTabs />);
    expect(screen.getAllByRole("tab")).toEqual([
      screen.getByRole("tab", { name: "SKILL.md", selected: true }),
    ]);
    const panel = screen.getByRole("tabpanel", { name: "SKILL.md" });
    expect(within(panel).getByRole("heading", { name: "API Gateway" })).toBeTruthy();
  });

  it("uses the shared skeleton while SKILL.md loads", () => {
    render(<TestTabs readmeContent={null} />);
    expect(screen.getByRole("status", { name: "Loading tab content" })).toBeTruthy();
  });

  it("keeps relative skill README links inside the viewed skill", () => {
    const { container } = render(
      <TestTabs
        readmeContent={[
          "[Google Mail](references/google-mail/README.md)",
          "[External](https://example.com/docs)",
          "[Usage](#usage)",
          "[Traversal](../references/README.md)",
        ].join("\n\n")}
      />,
    );
    expect(screen.getByRole("link", { name: "Google Mail" }).getAttribute("href")).toBe(
      "/api/v1/skills/api-gateway/file?path=references%2Fgoogle-mail%2FREADME.md",
    );
    expect(screen.getByRole("link", { name: "External" }).getAttribute("href")).toBe(
      "https://example.com/docs",
    );
    expect(screen.getByRole("link", { name: "Usage" }).getAttribute("href")).toBe("#usage");
    const traversal = Array.from(container.querySelectorAll("a")).find(
      (link) => link.textContent === "Traversal",
    );
    expect(traversal?.getAttribute("href")).toBe("");
  });

  it("keeps relative README links in the viewed owner namespace", () => {
    render(<TestTabs ownerHandle="clawkit" readmeContent="[Usage](docs/Usage.md)" />);
    expect(screen.getByRole("link", { name: "Usage" }).getAttribute("href")).toBe(
      "/api/v1/skills/api-gateway/file?path=docs%2FUsage.md&ownerHandle=clawkit",
    );
  });

  it("uses a custom README link resolver when provided", () => {
    render(
      <TestTabs
        readmeContent="[Source doc](references/install.md)"
        readmeHrefResolver={(href) => `https://github.com/NVIDIA/skills/blob/abc/${href}`}
      />,
    );
    expect(screen.getByRole("link", { name: "Source doc" }).getAttribute("href")).toBe(
      "https://github.com/NVIDIA/skills/blob/abc/references/install.md",
    );
  });
});

describe("skill detail tab contracts", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });
  it("keeps the complete header order and stable panel identifiers", () => {
    render(
      <TestTabs
        evaluationContent={<p>Evaluation result</p>}
        clawdis={
          {
            requires: { env: ["TODOIST_API_TOKEN"] },
            dependencies: [{ name: "ripgrep", type: "brew", url: "https://example.com/rg" }],
            install: [{ kind: "brew", formula: "ripgrep", bins: ["rg"] }],
            links: { homepage: "https://example.com" },
          } as ClawdisSkillMetadata
        }
      />,
    );
    const tabs = within(screen.getByRole("tablist", { name: "Skill detail tabs" })).getAllByRole(
      "tab",
    );
    expect(tabs.map((tab) => [tab.textContent, tab.id, tab.getAttribute("aria-controls")])).toEqual(
      [
        ["readme", "SKILL.md"],
        ["evaluation", "Evals"],
        ["runtime", "Requirements"],
        ["dependencies", "Dependencies"],
        ["install", "Install"],
        ["links", "Links"],
      ].map(([id, label]) => [label, "skill-tab-" + id, "skill-tabpanel-" + id]),
    );
    expect(screen.queryByText("Evaluation result")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Evals" }));
    expect(screen.getByRole("tabpanel", { name: "Evals" }).textContent).toBe("Evaluation result");
    fireEvent.click(screen.getByRole("tab", { name: "Requirements" }));
    expect(screen.getByText("TODOIST_API_TOKEN")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Dependencies" }));
    expect(screen.getByText("ripgrep")).toBeTruthy();
    expect(screen.getByRole("link", { name: /example\.com\/rg/ })).toBeTruthy();
  });

  it.each([
    [{ requires: { bins: [" "] } }, "Requirements"],
    [{ primaryEnv: " " }, "Requirements"],
    [{ envVars: [{ name: " " }] }, "Requirements"],
    [{ dependencies: [{}] }, "Dependencies"],
    [{ install: [{}] }, "Install"],
    [{ links: { homepage: " " } }, "Links"],
  ])("retains raw declared metadata presence for %j", (clawdis, label) => {
    render(<TestTabs clawdis={clawdis as ClawdisSkillMetadata} />);
    expect(screen.getByRole("tab", { name: label as string })).toBeTruthy();
  });

  it("retains an OS-only runtime tab even without a metadata object", () => {
    render(<TestTabs initialTab="runtime" osLabels={["macOS"]} />);
    expect(screen.getByRole("tab", { name: "Requirements" })).toBeTruthy();
    expect(screen.getByRole("tabpanel", { name: "Requirements" }).textContent).toBe("");
  });

  it.each(["readme", "evaluation", "runtime", "dependencies", "install", "links"])(
    "recognizes the #%s tab hash",
    (id) => {
      expect(skillTabFromHash("#" + id)).toBe(id);
    },
  );

  it.each(["skill-card", "card", "files", "compare", "diff", "versions"])(
    "does not resolve #%s to an inline tab",
    (id) => {
      expect(skillTabFromHash("#" + id)).toBeNull();
    },
  );

  it("updates and clears the tab hash without losing the current query or scroll position", () => {
    window.history.replaceState(null, "", "/maker/skills/tab-contract?q=kept");

    render(<TestTabs evaluationContent={<p>Evaluation result</p>} />);
    fireEvent.click(screen.getByRole("tab", { name: "Evals" }));
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/maker/skills/tab-contract?q=kept#evaluation",
    );
    expect(window.scrollTo).toHaveBeenCalledWith(window.scrollX, window.scrollY);
    fireEvent.click(screen.getByRole("tab", { name: "SKILL.md" }));
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/maker/skills/tab-contract?q=kept",
    );
  });
});
