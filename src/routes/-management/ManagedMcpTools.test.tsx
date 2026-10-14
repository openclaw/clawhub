import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ManagedMcpDefinition } from "clawhub-schema";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManagedMcpTools } from "./ManagedMcpTools";

const { getDefinition, publish, unpublish } = vi.hoisted(() => ({
  getDefinition: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useAction: (reference: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(reference);
    if (name === "managedMcp:getDefinition") return getDefinition;
    if (name === "managedMcp:publish") return publish;
    if (name === "managedMcp:unpublish") return unpublish;
    throw new Error(`Unexpected action: ${name}`);
  },
}));

const definition: ManagedMcpDefinition = {
  id: "deepwiki",
  name: "DeepWiki",
  company: "Cognition",
  description: "Read public repository documentation.",
  category: "developer-tools",
  version: "1.0.0",
  connection: {
    url: "https://mcp.deepwiki.com/mcp",
    transport: "streamable-http",
    auth: { kind: "none" },
  },
  icon: { pngBase64: "aWNvbg==", license: "MIT", attribution: "OpenClaw" },
};

beforeEach(() => {
  vi.resetAllMocks();
  getDefinition.mockResolvedValue(null);
});

function submitForm() {
  const form = screen.getByRole("button", { name: "Publish version" }).closest("form");
  if (!form) throw new Error("Managed MCP form missing");
  fireEvent.submit(form);
}

describe("ManagedMcpTools", () => {
  it("waits for backend eligibility before offering managed actions", async () => {
    let resolve!: (value: ManagedMcpDefinition) => void;
    getDefinition.mockReturnValue(new Promise((done) => (resolve = done)));
    render(<ManagedMcpTools packageName="@openclaw/deepwiki" />);
    expect(screen.queryByRole("button", { name: "Edit MCP integration" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unpublish MCP integration" })).toBeNull();

    await act(async () => resolve(definition));

    expect(screen.getByRole("button", { name: "Edit MCP integration" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unpublish MCP integration" })).toBeTruthy();
    expect(getDefinition).toHaveBeenCalledWith({ id: "deepwiki" });
  });

  it.each([null, new Error("Package is not a managed MCP integration")])(
    "does not infer managed eligibility from an @openclaw name (%s)",
    async (result) => {
      if (result instanceof Error) getDefinition.mockRejectedValue(result);
      else getDefinition.mockResolvedValue(result);
      await act(async () => {
        render(<ManagedMcpTools packageName="@openclaw/ordinary-plugin" />);
      });

      expect(screen.queryByRole("button", { name: "Edit MCP integration" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Unpublish MCP integration" })).toBeNull();
      expect(screen.getByRole("button", { name: "Add MCP integration" })).toBeTruthy();
    },
  );

  it("ignores eligibility responses for a previous selection", async () => {
    let resolve!: (value: ManagedMcpDefinition) => void;
    getDefinition.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    const page = render(<ManagedMcpTools packageName="@openclaw/deepwiki" />);
    page.rerender(<ManagedMcpTools packageName="@openclaw/ordinary-plugin" />);
    await act(async () => resolve(definition));
    expect(screen.queryByRole("button", { name: "Edit MCP integration" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unpublish MCP integration" })).toBeNull();
  });

  it("hides verified actions immediately after changing selection", async () => {
    getDefinition.mockResolvedValueOnce(definition);
    const page = render(<ManagedMcpTools packageName="@openclaw/deepwiki" />);
    await screen.findByRole("button", { name: "Edit MCP integration" });
    page.rerender(<ManagedMcpTools packageName="@another/company" />);
    expect(screen.queryByRole("button", { name: "Edit MCP integration" })).toBeNull();
    expect(getDefinition).toHaveBeenCalledTimes(1);
  });

  it("keeps an unpublish rejection visible inside its confirmation dialog", async () => {
    getDefinition.mockResolvedValue(definition);
    unpublish.mockRejectedValueOnce(new Error("Publication is still pending."));
    render(<ManagedMcpTools packageName="@openclaw/deepwiki" />);
    fireEvent.click(await screen.findByRole("button", { name: "Unpublish MCP integration" }));
    const dialog = screen.getByRole("dialog", { name: "Unpublish @openclaw/deepwiki?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unpublish" }));

    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      "Publication is still pending.",
    );
    expect(unpublish).toHaveBeenCalledExactlyOnceWith({ id: "deepwiki" });
    expect(
      (within(dialog).getByRole("button", { name: "Unpublish" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("retains a new pending submission receipt without a broken public link", async () => {
    publish.mockResolvedValue({
      ok: true,
      packageId: "packages:deepwiki",
      releaseId: "packageReleases:new",
      attemptId: "publishAttempts:new",
      publicationStatus: "pending",
    });
    render(<ManagedMcpTools />);
    fireEvent.click(screen.getByRole("button", { name: "Add MCP integration" }));
    fireEvent.change(screen.getByLabelText("Integration id"), { target: { value: "deepwiki" } });
    submitForm();

    expect((await screen.findByRole("status")).textContent).toContain("@openclaw/deepwiki@1.0.0");
    expect(screen.getByRole("status").textContent).toContain("pending publication at submission");
    expect(screen.getByText(/Submission receipt/).textContent).toContain("packageReleases:new");
    expect(screen.getByText(/Submission receipt/).textContent).toContain("publishAttempts:new");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("does not link a pending update to the existing published version", async () => {
    getDefinition.mockResolvedValue(definition);
    publish.mockResolvedValue({
      ok: true,
      packageId: "packages:deepwiki",
      releaseId: "packageReleases:update",
      attemptId: "publishAttempts:update",
      publicationStatus: "pending",
    });
    render(<ManagedMcpTools packageName="@openclaw/deepwiki" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit MCP integration" }));
    await screen.findByRole("dialog", { name: "Publish an updated MCP integration" });
    submitForm();

    expect((await screen.findByRole("status")).textContent).toContain("@openclaw/deepwiki@1.0.1");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/Submission receipt/).textContent).toContain("packageReleases:update");
  });

  it("previews a replacement icon, clears inherited rights, and publishes a new version", async () => {
    getDefinition.mockResolvedValue(definition);
    publish.mockResolvedValue({ releaseId: "packageReleases:icon", publicationStatus: "pending" });
    render(<ManagedMcpTools packageName="@openclaw/deepwiki" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit MCP integration" }));
    await screen.findByRole("dialog", { name: "Publish an updated MCP integration" });
    expect(screen.getByRole("img", { name: "Icon for this version" }).getAttribute("src")).toBe(
      `data:image/png;base64,${definition.icon.pngBase64}`,
    );
    fireEvent.change(screen.getByLabelText("Replace icon (PNG, optional)"), {
      target: { files: [new File(["replacement image"], "official.png", { type: "image/png" })] },
    });
    expect((screen.getByLabelText("Icon license or rights") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Icon attribution") as HTMLInputElement).value).toBe("");
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "Icon for this version" }).getAttribute("src")).toBe(
        `data:image/png;base64,${btoa("replacement image")}`,
      ),
    );
    for (const [label, value] of [
      ["Icon license or rights", "Provider brand terms"],
      ["Icon attribution", "Cognition"],
      ["Official icon source URL", "https://deepwiki.com/icon.png"],
      ["Icon license or brand terms URL", "https://cognition.ai/terms"],
    ]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    submitForm();
    await screen.findByRole("status");
    expect(publish).toHaveBeenCalledExactlyOnceWith({
      definition: {
        ...definition,
        version: "1.0.1",
        icon: {
          pngBase64: btoa("replacement image"),
          license: "Provider brand terms",
          attribution: "Cognition",
          sourceUrl: "https://deepwiki.com/icon.png",
          licenseUrl: "https://cognition.ai/terms",
        },
      },
    });
  });

  it("retains icon provenance when an edit keeps the existing image", async () => {
    const branded = {
      ...definition,
      icon: {
        ...definition.icon,
        license: "Provider brand terms",
        sourceUrl: "https://deepwiki.com/icon.png",
        licenseUrl: "https://cognition.ai/terms",
      },
    };
    getDefinition.mockResolvedValue(branded);
    publish.mockResolvedValue({ releaseId: "packageReleases:icon", publicationStatus: "pending" });
    render(<ManagedMcpTools packageName="@openclaw/deepwiki" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit MCP integration" }));
    await screen.findByRole("dialog", { name: "Publish an updated MCP integration" });
    submitForm();
    await screen.findByRole("status");
    expect(publish).toHaveBeenCalledWith({ definition: { ...branded, version: "1.0.1" } });
  });

  it.each([
    ["SVG", () => new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" })],
    [
      "oversized PNG",
      () => new File([new Uint8Array(512 * 1024 + 1)], "large.png", { type: "image/png" }),
    ],
  ] as const)(
    "rejects unsupported replacement images before submission (%s)",
    async (_label, makeFile) => {
      getDefinition.mockResolvedValue(definition);
      render(<ManagedMcpTools packageName="@openclaw/deepwiki" />);
      fireEvent.click(await screen.findByRole("button", { name: "Edit MCP integration" }));
      await screen.findByRole("dialog", { name: "Publish an updated MCP integration" });
      fireEvent.change(screen.getByLabelText("Replace icon (PNG, optional)"), {
        target: { files: [makeFile()] },
      });
      expect(screen.getByRole("alert").textContent).toContain("PNG icon no larger than 512KB");
      expect(
        (screen.getByRole("button", { name: "Publish version" }) as HTMLButtonElement).disabled,
      ).toBe(true);
      submitForm();
      expect(publish).not.toHaveBeenCalled();
    },
  );

  it("offers a public link only for confirmed publication and clears a previous receipt", async () => {
    publish.mockResolvedValue({
      ok: true,
      packageId: "packages:deepwiki",
      releaseId: "packageReleases:published",
      publicationStatus: "published",
    });
    render(<ManagedMcpTools />);
    fireEvent.click(screen.getByRole("button", { name: "Add MCP integration" }));
    fireEvent.change(screen.getByLabelText("Integration id"), { target: { value: "deepwiki" } });
    submitForm();

    const link = await screen.findByRole("link", { name: "View published package" });
    expect(link.getAttribute("href")).toBe("/openclaw/plugins/deepwiki");
    expect(screen.getByRole("status").textContent).toBe("@openclaw/deepwiki@1.0.0 published.");
    fireEvent.click(screen.getByRole("button", { name: "Add MCP integration" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByText(/Submission receipt/)).toBeNull());
    expect(screen.queryByRole("link")).toBeNull();
  });
});
