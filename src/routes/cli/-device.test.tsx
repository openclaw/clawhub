/* @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const approveMock = vi.fn();
const denyMock = vi.fn();
const useMutationMock = vi.fn();
const useQueryMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component: unknown }) => config,
}));

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("../../../convex/_generated/api", () => ({
  api: {
    cliDeviceAuth: {
      approve: "approve",
      deny: "deny",
      describePending: "describePending",
    },
  },
}));

vi.mock("../../lib/useAuthStatus", () => ({
  useAuthStatus: () => ({
    isAuthenticated: true,
    isLoading: false,
    me: { _id: "user_123" },
  }),
}));

vi.mock("../../components/layout/Container", () => ({
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../components/SignInButton", () => ({
  SignInButton: () => null,
}));

vi.mock("../../components/skeletons/ProtectedPageSkeletons", () => ({
  AuthFlowSkeleton: () => null,
}));

vi.mock("../../components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("../../components/ui/card", () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
}));

vi.mock("../../components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("../../components/ui/label", () => ({
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}));

const { CliDeviceAuth } = await import("./device");

const pendingDescription = {
  state: "pending",
  label: "ssh box",
  createdAt: Date.parse("2026-11-10T15:00:00.000Z"),
  expiresAt: Date.parse("2099-01-01T00:00:00.000Z"),
  access: "full",
};

function typeCode(value = "ABCD-2345") {
  fireEvent.change(screen.getByLabelText("Code"), { target: { value } });
}

function describeCodeAs(result: () => unknown) {
  useQueryMock.mockImplementation((_query: unknown, args: unknown) => {
    if (!args || args === "skip") return undefined;
    return result();
  });
}

// Messages wrap the command in <code>, so match on the paragraph's full text.
function paragraph(text: string) {
  return (_content: string, element: Element | null) =>
    element?.tagName === "P" && element.textContent === text;
}

const EXPIRED_MESSAGE = "That code expired. Run clawhub login again and type the new code.";
const USED_MESSAGE =
  "That code was already used. If your terminal is not signed in, run clawhub login again and type the new code.";
const MISSING_MESSAGE =
  "That code is not waiting for approval. Check the code in your terminal and type it again. If it still does not match, run clawhub login for a new code.";

describe("CliDeviceAuth", () => {
  beforeEach(() => {
    approveMock.mockReset();
    denyMock.mockReset();
    useMutationMock.mockReset();
    useQueryMock.mockReset();
    useQueryMock.mockImplementation((_query: unknown, args: unknown) => {
      if (!args || args === "skip") return undefined;
      return pendingDescription;
    });
    window.history.replaceState(null, "", "/cli/device?user_code=ABCD-2345");
  });

  it("leaves the code blank when the link already contains user_code", () => {
    useMutationMock.mockReturnValue(vi.fn());

    render(<CliDeviceAuth />);

    expect(screen.getByLabelText("Code")).toHaveProperty("value", "");
    expect(screen.getByText(/code is not filled in for you/)).toBeTruthy();
  });

  it("leaves the code blank for a legacy device-shaped code param", () => {
    window.history.replaceState(null, "", "/cli/device?code=ABCD-2345");
    useMutationMock.mockReturnValue(vi.fn());

    render(<CliDeviceAuth />);

    expect(screen.getByLabelText("Code")).toHaveProperty("value", "");
  });

  it("does not approve a code that was only present on the link", () => {
    useMutationMock.mockReturnValue(approveMock);

    render(<CliDeviceAuth />);

    fireEvent.click(screen.getByRole("button", { name: "Authorize" }));

    expect(approveMock).not.toHaveBeenCalled();
  });

  it("disables approval when the pending code reaches its expiry time", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-10T15:14:00.000Z"));
      useQueryMock.mockImplementation((_query: unknown, args: unknown) => {
        if (!args || args === "skip") return undefined;
        return {
          ...pendingDescription,
          expiresAt: Date.parse("2026-11-10T15:15:00.000Z"),
        };
      });
      useMutationMock.mockReturnValue(vi.fn());

      render(<CliDeviceAuth />);
      typeCode();

      expect(screen.getByRole("button", { name: "Authorize" })).toHaveProperty("disabled", false);
      expect(screen.getByText("Label: ssh box")).toBeTruthy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(screen.getByRole("button", { name: "Authorize" })).toHaveProperty("disabled", true);
      expect(screen.getByRole("button", { name: "Deny" })).toHaveProperty("disabled", true);
      expect(screen.getByText(paragraph(EXPIRED_MESSAGE))).toBeTruthy();
      expect(screen.queryByText("Label: ssh box")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["expired", EXPIRED_MESSAGE],
    ["used", USED_MESSAGE],
    ["missing", MISSING_MESSAGE],
  ])("tells the user how to recover from a %s code", (state, message) => {
    describeCodeAs(() => ({ state }));
    useMutationMock.mockReturnValue(vi.fn());

    render(<CliDeviceAuth />);
    typeCode();

    expect(screen.getByText(paragraph(message))).toBeTruthy();
    expect(screen.getByRole("button", { name: "Authorize" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Deny" })).toHaveProperty("disabled", true);
  });

  it("shows the token label before authorization", () => {
    useMutationMock.mockReturnValue(vi.fn());

    render(<CliDeviceAuth />);
    typeCode();

    expect(screen.getByText("Label: ssh box")).toBeTruthy();
    expect(screen.getByText("Started: 2026-11-10T15:00:00.000Z")).toBeTruthy();
    expect(screen.getByText(/full API token/)).toBeTruthy();
  });

  it("allows only one device decision while the mutation is pending", async () => {
    let resolveApprove!: () => void;
    approveMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveApprove = resolve;
        }),
    );
    denyMock.mockResolvedValue(undefined);
    useMutationMock.mockImplementation((mutation: string) =>
      mutation === "approve" ? approveMock : denyMock,
    );

    render(<CliDeviceAuth />);
    typeCode();

    const authorize = screen.getByRole("button", { name: "Authorize" });
    const deny = screen.getByRole("button", { name: "Deny" });
    await act(async () => {
      fireEvent.click(authorize);
      fireEvent.click(authorize);
      fireEvent.click(deny);
    });

    expect(approveMock).toHaveBeenCalledTimes(1);
    expect(denyMock).not.toHaveBeenCalled();
    expect(authorize).toHaveProperty("disabled", true);
    expect(deny).toHaveProperty("disabled", true);

    await act(async () => {
      resolveApprove();
    });

    expect(screen.getByText("Authorized. You can return to your terminal.")).toBeTruthy();
    expect(authorize).toHaveProperty("disabled", true);
    expect(deny).toHaveProperty("disabled", true);
  });

  it("shows a clean message when a device code was already used", async () => {
    approveMock.mockRejectedValue(
      new Error(
        "[CONVEX M(cliDeviceAuth:approve)] [Request ID: test] Server Error Called by client ConvexError: Device code already used",
      ),
    );
    denyMock.mockResolvedValue(undefined);
    useMutationMock.mockImplementation((mutation: string) =>
      mutation === "approve" ? approveMock : denyMock,
    );

    render(<CliDeviceAuth />);
    typeCode();

    fireEvent.click(screen.getByRole("button", { name: "Authorize" }));

    expect(await screen.findByText("Device code already used")).toBeTruthy();
    expect(screen.queryByText(/Server Error Called by client/)).toBeNull();
  });
});
