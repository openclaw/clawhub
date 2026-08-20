/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./traffic-explanation";

const useQueryMock = vi.fn();
const submitMock = vi.fn();
const useAuthStatusMock = vi.fn();
const searchMock = vi.fn();
const VALID_TOKEN = "a".repeat(64);

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: () => submitMock,
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => useAuthStatusMock(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useSearch: () => searchMock(),
  }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const request = {
  signalId: "publisherAbuseSignals:traffic",
  scope: "skill",
  skillDisplayName: "Popular Skill",
  skillSlug: "popular-skill",
  publisherHandle: "owner",
  response: null,
};

const TrafficExplanationPage = (Route as unknown as { component: ComponentType }).component;

describe("traffic explanation page", () => {
  beforeEach(() => {
    searchMock.mockReturnValue({
      signal: "publisherAbuseSignals:traffic",
      token: VALID_TOKEN,
    });
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:owner", handle: "owner" },
    });
    useQueryMock.mockReturnValue(request);
    submitMock.mockReset();
    submitMock.mockResolvedValue({ ok: true });
  });

  it("makes clear that the request is not enforcement", () => {
    render(<TrafficExplanationPage />);

    expect(screen.getByText("No action taken")).toBeTruthy();
    expect(screen.getByText("Help us understand this traffic")).toBeTruthy();
    expect(screen.getByText(/unusually high download activity/)).toBeTruthy();
    expect(screen.queryByText(/330,000/)).toBeNull();
    expect(screen.queryByText(/past 30 days/)).toBeNull();
    expect(
      screen.getByText("Your skill and account remain active. This is not a warning or penalty."),
    ).toBeTruthy();
    expect(screen.queryByText(/ban/i)).toBeNull();
  });

  it("presents a publisher-wide request without exposing detection thresholds", () => {
    useQueryMock.mockReturnValue({
      ...request,
      scope: "publisher",
      publisherHandle: "portfolio-owner",
      allPublisherSkills: true,
    });

    render(<TrafficExplanationPage />);

    expect(screen.getByText(/across skills published by/)).toBeTruthy();
    expect(screen.getByText("@portfolio-owner")).toBeTruthy();
    expect(screen.queryByText(/98%/)).toBeNull();
    expect(screen.queryByText(/60 days/)).toBeNull();
  });

  it("does not query or show a request when the link token is missing", () => {
    searchMock.mockReturnValue({ signal: "publisherAbuseSignals:traffic" });

    render(<TrafficExplanationPage />);

    expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), "skip");
    expect(screen.getByText("This traffic request is unavailable")).toBeTruthy();
  });

  it("requires context when the owner expected the traffic", async () => {
    render(<TrafficExplanationPage />);

    fireEvent.click(screen.getByRole("radio", { name: /Yes, I expected it/ }));
    const submitButton = screen.getByRole("button", { name: "Submit explanation" });
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText("Tell us what you think caused the traffic before submitting."),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/What do you think caused it/), {
      target: { value: "Shared in our newsletter." },
    });
    expect((submitButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submitButton);

    await waitFor(() =>
      expect(submitMock).toHaveBeenCalledWith({
        signalId: "publisherAbuseSignals:traffic",
        token: VALID_TOKEN,
        kind: "expected",
        message: "Shared in our newsletter.",
      }),
    );
  });

  it("accepts an unrecognized-traffic response without invented details", async () => {
    render(<TrafficExplanationPage />);

    fireEvent.click(screen.getByRole("radio", { name: /No, I don't recognize it/ }));
    fireEvent.click(screen.getByRole("button", { name: "Submit explanation" }));

    await waitFor(() =>
      expect(submitMock).toHaveBeenCalledWith({
        signalId: "publisherAbuseSignals:traffic",
        token: VALID_TOKEN,
        kind: "not_recognized",
      }),
    );
  });
});
