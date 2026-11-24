/* @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { FunctionReturnType } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { api } from "../../../convex/_generated/api";
import { ConnectionsPanel, type ConnectionReturn } from "./ConnectionsPanel";

type Overview = NonNullable<FunctionReturnType<typeof api.connections.getMine>>;
type App = Overview["apps"][number];

const actions = {
  startConnect: vi.fn(),
  verify: vi.fn(),
  cancelConnect: vi.fn(),
  disconnect: vi.fn(),
  listTools: vi.fn(),
};

vi.mock("convex/react", () => ({
  useAction: (reference: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(reference).split(":")[1] as keyof typeof actions;
    return actions[name];
  },
}));

const TOOLS = ["GRANOLA_MCP_LIST_MEETINGS", "GRANOLA_MCP_GET_MEETING_TRANSCRIPT"];

function granola(overrides: Partial<App> = {}): App {
  return {
    id: "granola",
    name: "Granola",
    description: "Read your Granola meeting notes, summaries and transcripts.",
    status: "disconnected",
    accountLabel: null,
    lastError: null,
    attemptStartedAt: null,
    tools: TOOLS,
    ...overrides,
  };
}

function renderPanel(app: App, returned: ConnectionReturn | null = null) {
  const onReturnHandled = vi.fn();
  const view = render(
    <ConnectionsPanel
      overview={{ apps: [app] }}
      returned={returned}
      onReturnHandled={onReturnHandled}
    />,
  );
  return {
    onReturnHandled,
    rerenderWith: (next: App) =>
      view.rerender(
        <ConnectionsPanel
          overview={{ apps: [next] }}
          returned={null}
          onReturnHandled={onReturnHandled}
        />,
      ),
  };
}

function stubNewTab() {
  const tab = { opener: {} as unknown, location: { href: "" }, close: vi.fn() };
  const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  return { tab, open };
}

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
  actions.verify.mockResolvedValue({ status: "disconnected" });
  actions.listTools.mockResolvedValue([
    { slug: TOOLS[0], name: "List meetings", description: "List the user's meeting notes." },
    {
      slug: TOOLS[1],
      name: "Get meeting transcript",
      description: `Get the full transcript.\n\n${"Speaker labels are explained here. ".repeat(8)}`,
    },
  ]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ConnectionsPanel", () => {
  it("shows a disconnected app with exactly its exposed tools and their descriptions", async () => {
    renderPanel(granola());

    expect(screen.getByRole("heading", { name: "Granola" })).toBeTruthy();
    expect(screen.getByText("Not connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect Granola" })).toBeTruthy();
    expect(screen.getByText(/2 read-only tools\./)).toBeTruthy();

    expect(await screen.findByText("List meetings")).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0] as HTMLElement).getByText(TOOLS[0] as string)).toBeTruthy();
    expect(
      within(items[0] as HTMLElement).getByText("List the user's meeting notes."),
    ).toBeTruthy();
    expect(actions.listTools).toHaveBeenCalledWith({ app: "granola" });

    const more = within(items[1] as HTMLElement).getByRole("button", {
      name: /Show full description/,
    });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
  });

  it("still lists the exposed tools when descriptions cannot be loaded", async () => {
    actions.listTools.mockRejectedValue(new Error("unavailable"));
    renderPanel(granola());

    expect(await screen.findByText("Tool descriptions are unavailable right now.")).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(TOOLS);
  });

  it("asks the server to check the connection when the page opens", async () => {
    renderPanel(granola());
    await waitFor(() => expect(actions.verify).toHaveBeenCalledWith({ app: "granola" }));
    expect(actions.verify).toHaveBeenCalledTimes(1);
  });

  it("warns when the connection cannot be checked", async () => {
    actions.verify.mockRejectedValue(new Error("down"));
    renderPanel(granola({ status: "connected", accountLabel: "ada@example.com" }));
    expect(await screen.findByText(/Could not check this connection right now\./)).toBeTruthy();
  });

  it("starts sign-in in a new tab and waits for the server to confirm", async () => {
    const { tab, open } = stubNewTab();
    actions.startConnect.mockResolvedValue({
      status: "pending",
      redirectUrl: "https://connect.composio.dev/link/lk_1",
      attemptId: "attempt-1",
    });
    const { rerenderWith } = renderPanel(granola());

    fireEvent.click(screen.getByRole("button", { name: "Connect Granola" }));

    // The tab is opened inside the click, before the server answers.
    expect(open).toHaveBeenCalledWith("", "_blank");
    await waitFor(() => expect(tab.location.href).toBe("https://connect.composio.dev/link/lk_1"));
    expect(tab.opener).toBeNull();
    expect(actions.startConnect).toHaveBeenCalledWith({ app: "granola" });

    rerenderWith(granola({ status: "pending", attemptStartedAt: 1 }));
    expect(screen.getByText("Waiting for sign-in")).toBeTruthy();
    expect(screen.getByText(/Finish signing in to Granola in the tab that opened\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open sign-in again/ }).getAttribute("href")).toBe(
      "https://connect.composio.dev/link/lk_1",
    );
    // Nothing claims success until the server reports it.
    expect(screen.queryByText("Connected")).toBeNull();
    expect(screen.queryByRole("button", { name: "Connect Granola" })).toBeNull();
  });

  it("offers a link when the browser blocks the new tab", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    actions.startConnect.mockResolvedValue({
      status: "pending",
      redirectUrl: "https://connect.composio.dev/link/lk_2",
      attemptId: "attempt-2",
    });
    const { rerenderWith } = renderPanel(granola());

    fireEvent.click(screen.getByRole("button", { name: "Connect Granola" }));
    await waitFor(() => expect(actions.startConnect).toHaveBeenCalled());
    rerenderWith(granola({ status: "pending", attemptStartedAt: 1 }));

    const link = await screen.findByRole("link", { name: /Open Granola sign-in/ });
    expect(link.getAttribute("href")).toBe("https://connect.composio.dev/link/lk_2");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText(/Your browser blocked the sign-in tab\./)).toBeTruthy();
  });

  it("closes the tab and reports the problem when sign-in cannot start", async () => {
    const { tab } = stubNewTab();
    actions.startConnect.mockRejectedValue(
      new Error("The connection service is not responding. Try again in a moment."),
    );
    renderPanel(granola());

    fireEvent.click(screen.getByRole("button", { name: "Connect Granola" }));

    expect(await screen.findByText(/The connection service is not responding\./)).toBeTruthy();
    expect(tab.close).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Connect Granola" })).toBeTruthy();
  });

  it("keeps checking while a sign-in is pending and lets the user cancel it", async () => {
    vi.useFakeTimers();
    actions.verify.mockResolvedValue({ status: "pending" });
    actions.cancelConnect.mockResolvedValue({ status: "disconnected" });
    renderPanel(granola({ status: "pending", attemptStartedAt: 1 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(actions.verify).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/If you closed that tab, cancel and connect again\./)).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(actions.verify).toHaveBeenCalledTimes(2);
    expect(actions.verify).toHaveBeenLastCalledWith({ app: "granola" });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(actions.cancelConnect).toHaveBeenCalledWith({ app: "granola" });
  });

  it("shows the connected account and disconnects after confirmation", async () => {
    actions.verify.mockResolvedValue({ status: "connected" });
    actions.disconnect.mockResolvedValue({ status: "disconnected" });
    renderPanel(granola({ status: "connected", accountLabel: "ada@example.com" }));

    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("ada@example.com")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect Granola" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(actions.disconnect).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/lose access to Granola right away/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect Granola" }));

    await waitFor(() => expect(actions.disconnect).toHaveBeenCalledWith({ app: "granola" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows a connection without an account name as connected", async () => {
    actions.verify.mockResolvedValue({ status: "connected" });
    renderPanel(granola({ status: "connected" }));
    await screen.findByText("List meetings");
    expect(screen.getAllByText("Connected")).toHaveLength(2);
    expect(screen.queryByText(/Connected as/)).toBeNull();
  });

  it("keeps the connection shown when disconnecting fails", async () => {
    actions.verify.mockResolvedValue({ status: "connected" });
    actions.disconnect.mockRejectedValue(
      new Error("The connection service is not responding. Try again in a moment."),
    );
    renderPanel(granola({ status: "connected", accountLabel: "ada@example.com" }));

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Disconnect Granola" }),
    );

    expect(await screen.findByText(/The connection service is not responding\./)).toBeTruthy();
    expect(screen.getByText("ada@example.com")).toBeTruthy();
  });

  it.each([
    ["failed", "Granola sign-in failed. Nothing was connected."],
    ["cancelled", "Granola sign-in was cancelled or did not finish. Nothing was connected."],
    ["expired", "Granola sign-in was not finished in time. Nothing was connected."],
    ["lost", "Granola is no longer connected. Connect again to restore access."],
  ] as const)("explains a %s sign-in or connection", async (lastError, message) => {
    renderPanel(granola({ lastError }));
    await screen.findByText("List meetings");
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.getByText("Not connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect Granola" })).toBeTruthy();
  });

  it("confirms a returned sign-in with the server before showing success", async () => {
    let finishVerify: (value: { status: string }) => void = () => {};
    actions.verify.mockReturnValue(
      new Promise((resolve) => {
        finishVerify = resolve;
      }),
    );
    const { onReturnHandled, rerenderWith } = renderPanel(
      granola({ status: "pending", attemptStartedAt: 1 }),
      { app: "granola", attempt: "attempt-1", status: "success" },
    );

    expect(actions.verify).toHaveBeenCalledWith({ app: "granola", attemptId: "attempt-1" });
    // The return URL saying "success" is not enough on its own.
    expect(screen.queryByText(/Granola is connected\./)).toBeNull();
    expect(onReturnHandled).not.toHaveBeenCalled();

    await act(async () => {
      finishVerify({ status: "connected" });
    });
    rerenderWith(granola({ status: "connected", accountLabel: "ada@example.com" }));

    expect(screen.getByText("Granola is connected. You can close this tab.")).toBeTruthy();
    expect(onReturnHandled).toHaveBeenCalledTimes(1);
  });

  it("reports a returned sign-in that the provider marked failed", async () => {
    const { onReturnHandled, rerenderWith } = renderPanel(
      granola({ status: "pending", attemptStartedAt: 1 }),
      { app: "granola", attempt: "attempt-1", status: "failed" },
    );

    await waitFor(() =>
      expect(actions.verify).toHaveBeenCalledWith({
        app: "granola",
        attemptId: "attempt-1",
        outcome: "failed",
      }),
    );
    await waitFor(() => expect(onReturnHandled).toHaveBeenCalled());
    rerenderWith(granola({ lastError: "cancelled" }));

    expect(screen.getByText(/sign-in was cancelled or did not finish/)).toBeTruthy();
    expect(screen.queryByText(/Granola is connected\./)).toBeNull();
  });

  it("says so when a returned sign-in is still unconfirmed", async () => {
    actions.verify.mockResolvedValue({ status: "pending" });
    renderPanel(granola({ status: "pending", attemptStartedAt: 1 }), {
      app: "granola",
      attempt: "attempt-1",
      status: "success",
    });
    expect(
      await screen.findByText("Still waiting for Granola to confirm the sign-in."),
    ).toBeTruthy();
    expect(screen.queryByText(/Granola is connected\./)).toBeNull();
  });
});
