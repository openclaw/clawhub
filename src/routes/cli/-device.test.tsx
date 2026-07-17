/* @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const approveMock = vi.fn();
const denyMock = vi.fn();
const useMutationMock = vi.fn();
const { useSearchMock } = vi.hoisted(() => ({
  useSearchMock: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component: unknown }) => ({
    ...config,
    useSearch: useSearchMock,
  }),
}));

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("../../../convex/_generated/api", () => ({
  api: {
    cliDeviceAuth: {
      approve: "approve",
      deny: "deny",
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

describe("CliDeviceAuth", () => {
  beforeEach(() => {
    approveMock.mockReset();
    denyMock.mockReset();
    useMutationMock.mockReset();
    useSearchMock.mockReturnValue({ user_code: "ABCD-2345" });
  });

  it("prefills the code from user_code", () => {
    useMutationMock.mockReturnValue(vi.fn());

    render(<CliDeviceAuth />);

    expect(screen.getByLabelText("Code")).toHaveProperty("value", "ABCD-2345");
  });

  it("prefills the code from a legacy device-shaped code param", () => {
    useSearchMock.mockReturnValue({ code: "ABCD-2345" });
    useMutationMock.mockReturnValue(vi.fn());

    render(<CliDeviceAuth />);

    expect(screen.getByLabelText("Code")).toHaveProperty("value", "ABCD-2345");
  });

  it("does not prefill an OAuth completion code from the legacy param", () => {
    useSearchMock.mockReturnValue({ code: "long-random-oauth-completion-code-1234567890" });
    useMutationMock.mockReturnValue(vi.fn());

    render(<CliDeviceAuth />);

    expect(screen.getByLabelText("Code")).toHaveProperty("value", "");
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
});
