import { useAuthActions } from "@convex-dev/auth/react";
import { Shield, User, UserCog, Wrench } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { getRuntimeEnv } from "../lib/runtimeEnv";
import { useAuthStatus } from "../lib/useAuthStatus";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

type DevPersona = "owner" | "user" | "admin";

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

export function DevPersonaFab() {
  const [busyPersona, setBusyPersona] = useState<DevPersona | "sign-out" | null>(null);
  const { signIn, signOut } = useAuthActions();
  const { me, isAuthenticated } = useAuthStatus();

  if (!isLocalDevPersonaEnabled()) return null;

  async function usePersona(persona: DevPersona) {
    setBusyPersona(persona);
    try {
      const result = await signIn("dev-persona", { persona });
      if (result.signingIn === false)
        throw new Error("Dev persona sign-in did not create a session");
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
      await signOut();
      toast.success("Signed out of dev persona");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign out failed");
    } finally {
      setBusyPersona(null);
    }
  }

  const currentHandle = me?.handle ? `@${me.handle}` : isAuthenticated ? "signed in" : "anonymous";

  return (
    <div className="fixed right-5 bottom-24 z-[70] flex flex-col items-end gap-2 sm:right-6">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            className="h-11 gap-2 rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-4 text-[color:var(--ink)] shadow-[var(--shadow)] hover:bg-[color:var(--surface-subtle)]"
            aria-label="Open local dev personas"
          >
            <Wrench size={16} aria-hidden="true" />
            <span>Dev</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[220px]">
          <div className="px-2 py-1.5">
            <p className="text-xs font-semibold text-[color:var(--ink)]">Local persona</p>
            <p className="text-xs text-[color:var(--ink-soft)]">{currentHandle}</p>
          </div>
          <DropdownMenuSeparator />
          {PERSONAS.map((persona) => {
            const Icon = persona.icon;
            const busy = busyPersona === persona.value;
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
