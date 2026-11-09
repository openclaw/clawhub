/* @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadsPage } from "./DownloadsPage";

const { query, refresh, client } = vi.hoisted(() => {
  const queryMock = vi.fn();
  return { query: queryMock, refresh: vi.fn(), client: { query: queryMock } };
});
vi.mock("convex/react", () => ({
  useConvex: () => client,
  useMutation: () => refresh,
}));

const summary = {
  scope: "templates",
  status: "ready",
  generatedAt: 1_793_930_400_000,
  windowStartAt: 1_793_844_000_000,
  windowEndAt: 1_793_930_400_000,
  downloadsLast24h: 42,
  downloadsAllTime: 12345,
  countingPaused: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  query.mockResolvedValue(summary);
  refresh.mockResolvedValue({ ...summary, refreshInProgress: true });
});

describe("admin download dashboard", () => {
  it("shows rolling 24-hour and lifetime counts from the same summary", async () => {
    render(<DownloadsPage />);
    expect(await screen.findByText("12,345")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Template downloads" })).toBeTruthy();
    expect(screen.getByText(/not yesterday/i)).toBeTruthy();
    expect(screen.getByText("Recorded downloads across public, undeleted Templates.")).toBeTruthy();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("shows no fabricated zeros before the first summary exists", async () => {
    query.mockResolvedValue({
      ...summary,
      status: "pending",
      generatedAt: null,
      windowStartAt: null,
      windowEndAt: null,
      downloadsLast24h: null,
      downloadsAllTime: null,
    });
    render(<DownloadsPage />);
    expect(await screen.findByText(/first summary is not ready/i)).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("distinguishes a recorded zero from unavailable data", async () => {
    query.mockResolvedValue({ ...summary, downloadsLast24h: 0, downloadsAllTime: 0 });
    render(<DownloadsPage />);
    await waitFor(() => expect(screen.getAllByText("0")).toHaveLength(2));
    expect(screen.queryByText(/first summary is not ready/i)).toBeNull();
  });

  it("preserves the last summary and explains a failed refresh", async () => {
    refresh.mockRejectedValue(new Error("Request failed"));
    render(<DownloadsPage />);
    await screen.findByText("12,345");
    fireEvent.click(screen.getByRole("button", { name: /refresh summary/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not refresh/i);
    expect(screen.getByText("12,345")).toBeTruthy();
  });

  it("reports a failed initial read without displaying zero counts", async () => {
    query.mockRejectedValue(new Error("Request failed"));
    render(<DownloadsPage />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not load/i);
    expect(screen.queryByText("0")).toBeNull();
  });

  it("marks an old summary stale without hiding its counts", async () => {
    query.mockResolvedValue({ ...summary, staleAfterAt: Date.now() - 1 });
    render(<DownloadsPage />);
    expect(await screen.findByText(/older than 30 minutes/i)).toBeTruthy();
    expect(screen.getByText("12,345")).toBeTruthy();
  });

  it("surfaces background refresh failure while retaining the completed report", async () => {
    query.mockResolvedValue({ ...summary, lastError: "Report refresh failed. Retry refresh." });
    render(<DownloadsPage />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Report refresh failed/);
    expect(screen.getByText("12,345")).toBeTruthy();
  });

  it("labels scheduled refresh as pending, not completed", async () => {
    render(<DownloadsPage />);
    await screen.findByText("12,345");
    fireEvent.click(screen.getByRole("button", { name: /refresh summary/i }));
    expect(await screen.findByText(/Refresh requested/i)).toBeTruthy();
    expect(refresh).toHaveBeenCalledWith({});
    expect(screen.getByText("12,345")).toBeTruthy();
  });

  it("does not invent a queued refresh during the server cooldown", async () => {
    refresh.mockResolvedValue({ ...summary, refreshInProgress: false });
    render(<DownloadsPage />);
    await screen.findByText("12,345");
    fireEvent.click(screen.getByRole("button", { name: /refresh summary/i }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByText(/Refresh requested/i)).toBeNull();
  });

  it("warns that paused counting can leave gaps", async () => {
    query.mockResolvedValue({ ...summary, countingPaused: true });
    render(<DownloadsPage />);
    expect(await screen.findByText(/download counting is paused/i)).toBeTruthy();
  });
});
