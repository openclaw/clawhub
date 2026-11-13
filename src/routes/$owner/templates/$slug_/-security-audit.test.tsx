import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SecurityAuditPage } from "../../../../components/SecurityAuditPage";
import { PackageApiError } from "../../../../lib/packageApi";
import {
  loadTemplateSecurityAudit,
  parseTemplateAuditSearch,
  Route,
  TemplateSecurityAuditPage,
} from "./security-audit";
const mocks = vi.hoisted(() => ({ fetchPackageDetail: vi.fn(), fetchPackageVersion: vi.fn() }));
vi.mock("../../../../lib/packageApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/packageApi")>()),
  ...mocks,
}));
const detail = (name = "@maker/music-manager", owner = "maker", family = "template") => ({
  package: { name, displayName: "Music Manager", family, latestVersion: "2.0.0" },
  owner: { handle: owner },
});
const release = (version = "1.0.0") => ({ version: { version, createdAt: 1, files: [] } });
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchPackageDetail.mockResolvedValue(detail());
  mocks.fetchPackageVersion.mockResolvedValue(release());
});
describe("Template audit identity and boundaries", () => {
  it("reads an exact historical release and parses version search", async () => {
    expect(parseTemplateAuditSearch({ version: " 1.0.0 ", other: true })).toEqual({
      version: "1.0.0",
    });
    const data = await loadTemplateSecurityAudit(
      { owner: "maker", slug: "music-manager" },
      "1.0.0",
    );
    expect(data.release?.version).toBe("1.0.0");
    expect(mocks.fetchPackageVersion).toHaveBeenCalledWith("@maker/music-manager", "1.0.0", {
      throwOnError: true,
    });
  });
  it("uses the same unscoped ownership lookup as Template detail", async () => {
    mocks.fetchPackageDetail
      .mockResolvedValueOnce({ package: null, owner: null })
      .mockResolvedValueOnce(detail("openclaw-music-manager", "ameliomansour"));
    await loadTemplateSecurityAudit(
      { owner: "ameliomansour", slug: "openclaw-music-manager" },
      "1.0.0",
    );
    expect(mocks.fetchPackageVersion).toHaveBeenCalledWith("openclaw-music-manager", "1.0.0", {
      throwOnError: true,
    });
  });
  it.each([
    detail("@maker/music-manager", "other"),
    detail("@maker/music-manager", "maker", "code-plugin"),
    { package: null, owner: null },
  ])("rejects wrong owner, family and absent package", async (value) => {
    mocks.fetchPackageDetail.mockResolvedValue(value);
    await expect(
      loadTemplateSecurityAudit({ owner: "maker", slug: "music-manager" }),
    ).rejects.toMatchObject({ isNotFound: true });
    expect(mocks.fetchPackageVersion).not.toHaveBeenCalled();
  });
  it.each([
    null,
    release("wrong"),
    { ...release(), package: { name: "@other/pkg", family: "template" } },
    { ...release(), package: { name: "@maker/music-manager", family: "code-plugin" } },
  ])("rejects missing/mismatched exact release", async (value) => {
    mocks.fetchPackageVersion.mockResolvedValue(value);
    await expect(
      loadTemplateSecurityAudit({ owner: "maker", slug: "music-manager" }, "1.0.0"),
    ).rejects.toMatchObject({ isNotFound: true });
  });
  it("does not conceal registry failures and renders explicit rate limiting", async () => {
    mocks.fetchPackageDetail.mockRejectedValueOnce(new Error("offline"));
    await expect(
      loadTemplateSecurityAudit({ owner: "maker", slug: "music-manager" }),
    ).rejects.toThrow("offline");
    mocks.fetchPackageDetail.mockRejectedValueOnce(new PackageApiError("limited", { status: 429 }));
    const data = await loadTemplateSecurityAudit({ owner: "maker", slug: "music-manager" });
    render(<TemplateSecurityAuditPage data={data} />);
    expect(screen.getByRole("status").textContent).toContain("rate limited");
  });
  it("renders no-release explicitly and does not fetch an arbitrary version", async () => {
    mocks.fetchPackageDetail.mockResolvedValue({
      ...detail(),
      package: { ...detail().package, latestVersion: null },
    });
    const data = await loadTemplateSecurityAudit({ owner: "maker", slug: "music-manager" });
    expect(mocks.fetchPackageVersion).not.toHaveBeenCalled();
    render(<TemplateSecurityAuditPage data={data} />);
    expect(screen.getByText(/No published release/)).toBeTruthy();
  });
  it("canonicalizes aliases without dropping version", async () => {
    mocks.fetchPackageDetail.mockResolvedValue(detail("@maker/canonical"));
    const loader = Route.options.loader;
    if (typeof loader !== "function") throw new Error("Missing loader");
    await expect(
      loader({ params: { owner: "maker", slug: "alias" }, deps: { version: "1.0.0" } } as never),
    ).rejects.toMatchObject({
      options: { href: "/maker/templates/canonical/security-audit?version=1.0.0", replace: true },
    });
  });
});
const entity = {
  kind: "template" as const,
  title: "Music Manager",
  name: "openclaw-music-manager",
  version: "1.0.0",
  detailPath: "/ameliomansour/templates/openclaw-music-manager",
};
describe("Template stored evidence rendering", () => {
  it("shows MCP/dynamic/supplemental IDs and evidence separately from the judge verdict", () => {
    render(
      <SecurityAuditPage
        entity={entity}
        sha256hash={"a".repeat(64)}
        llmAnalysis={{
          status: "completed",
          verdict: "benign",
          summary: "Judge accepted the declared behavior.",
          model: "evidence-judge",
          checkedAt: 1,
        }}
        aigAnalysis={{
          status: "suspicious",
          scannerVersion: "0.2.0",
          issueCount: 3,
          checkedAt: 1,
          findings: ["MCP-001", "SUPPLEMENTAL-002", "dynamic.custom-rule"].map((ruleId) => ({
            ruleId,
            level: "warning",
            message: "Review workspace access.",
            file: "CLAW.md",
            startLine: 8,
            endLine: 10,
          })),
        }}
      />,
    );
    for (const id of ["MCP-001", "SUPPLEMENTAL-002", "dynamic.custom-rule"])
      expect(screen.getByRole("heading", { name: id })).toBeTruthy();
    expect(screen.getByText("Pass")).toBeTruthy();
    expect(screen.queryByText("SkillSpector")).toBeNull();
    expect(screen.queryByText("Vulnerability Patterns")).toBeNull();
    expect(screen.queryByRole("link", { name: "A.I.G" })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to Template" }).getAttribute("href")).toBe(
      entity.detailPath,
    );
    expect(screen.getByText("a".repeat(64))).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Rescan" })).toBeNull();
  });
  it("does not invent scanners or a clean result when reports are missing", () => {
    render(<SecurityAuditPage entity={entity} />);
    expect(screen.getByText(/No stored scanner evidence/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "SkillSpector" })).toBeNull();
    expect(screen.queryByText("Pass")).toBeNull();
  });
  it("keeps legacy SkillSpector reports without fabricated clean checks", () => {
    render(
      <SecurityAuditPage
        entity={entity}
        skillSpectorAnalysis={{
          status: "clean",
          issueCount: 0,
          issues: [],
          scannerVersion: "legacy",
          checkedAt: 1,
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "SkillSpector" })).toBeTruthy();
    expect(screen.queryByText("Vulnerability Patterns")).toBeNull();
  });
  it.each(["pending", "error"])("shows %s evidence without clean checks", (status) => {
    render(
      <SecurityAuditPage
        entity={entity}
        aigAnalysis={{
          status,
          error: status === "error" ? "Scanner failed." : undefined,
          issueCount: 0,
          findings: [],
          checkedAt: 1,
        }}
      />,
    );
    expect(screen.queryByText("Vulnerability Patterns")).toBeNull();
    expect(screen.queryByText("No findings were reported.", { exact: false })).toBeNull();
  });
});
