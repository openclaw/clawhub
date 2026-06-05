import { createFileRoute } from "@tanstack/react-router";
import { ShieldX } from "lucide-react";
import { Button } from "../components/ui/button";
import { ACCOUNT_APPEAL_URL } from "../lib/authErrorMessage";

export const Route = createFileRoute("/account-banned")({
  component: AccountBannedPage,
});

export function AccountBannedPage() {
  return (
    <main className="relative mx-auto flex min-h-[430px] w-full flex-col overflow-hidden px-4 pb-12 pt-20 sm:px-6 sm:pt-24 lg:px-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-20 inset-x-10 h-64"
        style={{
          background:
            "linear-gradient(to bottom, color-mix(in srgb, var(--accent) 16%, transparent), color-mix(in srgb, var(--accent) 4%, transparent) 42%, transparent 74%)",
          filter: "blur(2px)",
          maskImage: "linear-gradient(to right, transparent, black 22%, black 78%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent, black 22%, black 78%, transparent)",
        }}
      />
      <section className="relative z-10 mx-auto w-full max-w-[780px] rounded-[var(--radius-md)] border border-[color:var(--line)] bg-[color:var(--surface)] px-5 py-8 shadow-[0_18px_50px_rgba(0,0,0,0.12)] sm:px-8 sm:py-10">
        <span className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-[var(--radius-md)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] text-[color:var(--ink-soft)]">
          <ShieldX size={22} />
        </span>
        <h1 className="font-display text-2xl font-black leading-tight text-[color:var(--ink)] sm:text-4xl">
          Your ClawHub account has been banned
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-[color:var(--ink-soft)]">
          This account cannot sign in to ClawHub.
        </p>
        <p className="mt-2 max-w-2xl text-base leading-7 text-[color:var(--ink-soft)]">
          Visit appeals.openclaw.ai to open an appeal if you believe this was a mistake.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Button asChild variant="primary">
            <a href={ACCOUNT_APPEAL_URL}>Open an appeal</a>
          </Button>
        </div>
      </section>
    </main>
  );
}
