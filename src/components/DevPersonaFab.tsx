import { useAuthActions } from "@convex-dev/auth/react";
import { Check, Shield, User, UserCog, Wrench } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { getRuntimeEnv } from "../lib/runtimeEnv";
import { useAuthStatus } from "../lib/useAuthStatus";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type DevPersona = "owner" | "user" | "admin";

const DEV_PERSONA_AUTH_TIMEOUT_MS = 10_000;

const PERSONAS: Array<{
  value: DevPersona;
  label: string;
  description: string;
  icon: typeof User;
}> = [
  {
    value: "owner",
    label: "Use Owner",
    description: "@local",
    icon: UserCog,
  },
  {
    value: "user",
    label: "Use User",
    description: "@local-user",
    icon: User,
  },
  {
    value: "admin",
    label: "Use Admin",
    description: "@local-admin",
    icon: Shield,
  },
];

function isLocalDevPersonaEnabled() {
  if (getRuntimeEnv("VITE_ENABLE_DEV_AUTH") !== "1") return false;
  if (typeof window === "undefined") return false;
  const hostname = window.location.hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1";
}

async function withDevAuthTimeout<T>(operation: Promise<T>) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("Dev persona auth timed out. Check the local Convex backend."));
        }, DEV_PERSONA_AUTH_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export function DevPersonaFab() {
  const [busyPersona, setBusyPersona] = useState<DevPersona | "sign-out" | null>(null);
  const [section, setSection] = useState("auth");
  const { signIn, signOut } = useAuthActions();
  const { me, isAuthenticated } = useAuthStatus();

  if (!isLocalDevPersonaEnabled()) return null;

  async function usePersona(persona: DevPersona) {
    setBusyPersona(persona);
    try {
      if (isAuthenticated) {
        await withDevAuthTimeout(signOut());
      }
      const result = await withDevAuthTimeout(signIn("dev-persona", { persona }));
      if (result.signingIn === false) {
        throw new Error("Dev persona sign-in did not create a session");
      }
      toast.success(`Using ${persona} persona`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Dev persona sign-in failed");
    } finally {
      setBusyPersona(null);
    }
  }

  async function endSession() {
    setBusyPersona("sign-out");
    try {
      await withDevAuthTimeout(signOut());
      toast.success("Signed out of dev persona");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign out failed");
    } finally {
      setBusyPersona(null);
    }
  }

  const activeHandle = me?.handle ? `@${me.handle}` : null;

  return (
    <div className="fixed right-5 bottom-5 z-[70] flex flex-col items-end gap-2 sm:right-6 sm:bottom-6">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center rounded-[9999px] border border-[color:var(--line)] bg-[color:var(--surface)] p-0 text-[color:var(--ink)] shadow-[var(--shadow)] transition-colors hover:bg-[color:var(--surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg)]"
            aria-label="Open local dev personas"
          >
            <Wrench size={22} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[220px]">
          <div className="px-2 py-1.5">
            <label className="sr-only" htmlFor="dev-persona-section">
              Local dev control section
            </label>
            <Select value={section} onValueChange={setSection}>
              <SelectTrigger
                id="dev-persona-section"
                size="sm"
                className="h-9 text-sm font-semibold"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="auth">Auth</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DropdownMenuSeparator />
          {PERSONAS.map((persona) => {
            const Icon = persona.icon;
            const busy = busyPersona === persona.value;
            const active = persona.description === activeHandle;
            return (
              <DropdownMenuItem
                key={persona.value}
                disabled={busyPersona !== null}
                onSelect={(event) => {
                  event.preventDefault();
                  void usePersona(persona.value);
                }}
              >
                <span className="flex w-full items-center gap-2">
                  <Icon size={15} aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span>{busy ? "Switching..." : persona.label}</span>
                    <span className="text-xs text-[color:var(--ink-soft)]">
                      {persona.description}
                    </span>
                  </span>
                  {active ? <Check size={15} aria-label="Active persona" /> : null}
                </span>
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={busyPersona !== null || !isAuthenticated}
            onSelect={(event) => {
              event.preventDefault();
              void endSession();
            }}
          >
            {busyPersona === "sign-out" ? "Signing out..." : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
