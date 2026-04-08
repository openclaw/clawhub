import { AlertTriangle } from "lucide-react";
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Button } from "./ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  /** When this value changes the boundary resets, clearing any caught error. */
  resetKey?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  /** Tracks the last resetKey that was acknowledged so we can detect changes. */
  prevResetKey?: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, prevResetKey: props.resetKey };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    if (props.resetKey !== undefined && props.resetKey !== state.prevResetKey) {
      return { hasError: false, error: null, prevResetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <ErrorFallback
          error={this.state.error}
          onRetry={() => this.setState({ hasError: false, error: null })}
        />
      );
    }
    return this.props.children;
  }
}

function extractErrorMessage(error: unknown): string {
  if (!error) return "An unexpected error occurred. Please try again.";
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  // Handle plain objects like { error: "message" } from API responses
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    if (typeof record.error === "string" && record.error.trim()) return record.error.trim();
    if (typeof record.message === "string" && record.message.trim()) return record.message.trim();
  }
  if (typeof error === "string" && error.trim()) return error.trim();
  return "An unexpected error occurred. Please try again.";
}

export function ErrorFallback({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-[var(--radius-md)] border border-[color:var(--line)] bg-[color:var(--surface)] p-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(255,107,74,0.12)]">
        <AlertTriangle className="h-6 w-6 text-[color:var(--accent)]" />
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-lg font-bold text-[color:var(--ink)]">
          Something went wrong
        </h3>
        <p className="max-w-md text-sm text-[color:var(--ink-soft)]">
          {extractErrorMessage(error)}
        </p>
      </div>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
