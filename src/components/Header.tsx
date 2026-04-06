import { useAuthActions } from "@convex-dev/auth/react";
import { Link } from "@tanstack/react-router";
import { Menu, Monitor, Moon, Plus, Search, Sun } from "lucide-react";
import { useMemo, useRef } from "react";
import { gravatarUrl } from "../lib/gravatar";
import { isModerator } from "../lib/roles";
import { getClawHubSiteUrl, getSiteMode, getSiteName } from "../lib/site";
import { applyTheme, useThemeMode } from "../lib/theme";
import { startThemeTransition } from "../lib/theme-transition";
import { useAuthError } from "../lib/useAuthError";
import { SignInButton } from "./SignInButton";
import { useAuthStatus } from "../lib/useAuthStatus";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "./ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

export default function Header() {
  const { isAuthenticated, isLoading, me } = useAuthStatus();
  const { signOut } = useAuthActions();
  const { mode, setMode } = useThemeMode();
  const toggleRef = useRef<HTMLDivElement | null>(null);
  const siteMode = getSiteMode();
  const siteName = useMemo(() => getSiteName(siteMode), [siteMode]);
  const isSoulMode = siteMode === "souls";
  const clawHubUrl = getClawHubSiteUrl();

  const avatar = me?.image ?? (me?.email ? gravatarUrl(me.email) : undefined);
  const handle = me?.handle ?? me?.displayName ?? "user";
  const initial = (me?.displayName ?? me?.name ?? handle).charAt(0).toUpperCase();
  const isStaff = isModerator(me);
  const { error: authError, clear: clearAuthError } = useAuthError();

  const setTheme = (next: "system" | "light" | "dark") => {
    startThemeTransition({
      nextTheme: next,
      currentTheme: mode,
      setTheme: (value) => {
        const nextMode = value as "system" | "light" | "dark";
        applyTheme(nextMode);
        setMode(nextMode);
      },
      context: { element: toggleRef.current },
    });
  };

  const navLinks = (
    <>
      {isSoulMode ? (
        <a
          href={clawHubUrl}
          className="text-[color:var(--ink-soft)] font-semibold text-sm transition-colors duration-150 hover:text-[color:var(--ink)]"
        >
          ClawHub
        </a>
      ) : null}
      {isSoulMode ? (
        <Link
          to="/souls"
          search={{
            q: undefined,
            sort: undefined,
            dir: undefined,
            view: undefined,
            focus: undefined,
          }}
          className="text-[color:var(--ink-soft)] font-semibold text-sm transition-colors duration-150 hover:text-[color:var(--ink)]"
        >
          Souls
        </Link>
      ) : (
        <Link
          to="/skills"
          search={{
            q: undefined,
            sort: undefined,
            dir: undefined,
            highlighted: undefined,
            nonSuspicious: undefined,
            view: undefined,
            focus: undefined,
          }}
          className="text-[color:var(--ink-soft)] font-semibold text-sm transition-colors duration-150 hover:text-[color:var(--ink)]"
        >
          Skills
        </Link>
      )}
      {isSoulMode ? null : (
        <Link
          to="/plugins"
          className="text-[color:var(--ink-soft)] font-semibold text-sm transition-colors duration-150 hover:text-[color:var(--ink)]"
        >
          Plugins
        </Link>
      )}
      <Link
        to={isSoulMode ? "/souls" : "/skills"}
        search={
          isSoulMode
            ? { q: undefined, sort: undefined, dir: undefined, view: undefined, focus: "search" }
            : {
                q: undefined,
                sort: undefined,
                dir: undefined,
                highlighted: undefined,
                nonSuspicious: undefined,
                view: undefined,
                focus: "search",
              }
        }
        className="text-[color:var(--ink-soft)] font-semibold text-sm transition-colors duration-150 hover:text-[color:var(--ink)] inline-flex items-center gap-1.5"
      >
        <Search className="h-3.5 w-3.5" />
        Search
      </Link>
      {isSoulMode ? null : (
        <Link
          to="/about"
          className="text-[color:var(--ink-soft)] font-semibold text-sm transition-colors duration-150 hover:text-[color:var(--ink)]"
        >
          About
        </Link>
      )}
      {me ? (
        <Link
          to="/stars"
          className="text-[color:var(--ink-soft)] font-semibold text-sm transition-colors duration-150 hover:text-[color:var(--ink)]"
        >
          Stars
        </Link>
      ) : null}
      {isStaff ? (
        <Link
          to="/management"
          search={{ skill: undefined }}
          className="text-[color:var(--ink-soft)] font-semibold text-sm transition-colors duration-150 hover:text-[color:var(--ink)]"
        >
          Management
        </Link>
      ) : null}
    </>
  );

  return (
    <header className="sticky top-0 z-50 border-b border-[color:var(--line)] bg-[color:var(--nav-bg)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-5">
        {/* Brand */}
        <Link
          to="/"
          search={{ q: undefined, highlighted: undefined, search: undefined }}
          className="flex items-center gap-2.5 font-display text-lg font-bold text-[color:var(--ink)] no-underline transition-opacity hover:opacity-80"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[color:var(--accent)] to-[color:var(--accent-deep)] p-0.5">
            <img
              src="/clawd-logo.png"
              alt=""
              aria-hidden="true"
              className="h-full w-full rounded-full object-cover"
            />
          </span>
          <span>{siteName}</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-6 md:flex">{navLinks}</nav>

        {/* Actions */}
        <div className="flex items-center gap-3">
          {/* Publish CTA (desktop, authenticated) */}
          {isAuthenticated && me && (
            <Link
              to="/publish-skill"
              search={{ updateSlug: undefined }}
              className="hidden sm:block"
            >
              <Button variant="primary" size="sm">
                <Plus className="h-3.5 w-3.5" />
                Publish
              </Button>
            </Link>
          )}

          {/* Mobile nav trigger */}
          <div className="md:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Open menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72">
                <SheetHeader>
                  <SheetTitle>{siteName}</SheetTitle>
                </SheetHeader>
                <nav className="mt-6 flex flex-col gap-4">{navLinks}</nav>
                {/* Mobile theme toggle */}
                <div className="mt-6 flex flex-col gap-2">
                  <span className="text-xs font-bold uppercase tracking-widest text-[color:var(--ink-soft)]">
                    Theme
                  </span>
                  <ToggleGroup
                    type="single"
                    value={mode}
                    onValueChange={(value) => {
                      if (!value) return;
                      setTheme(value as "system" | "light" | "dark");
                    }}
                    aria-label="Theme mode"
                  >
                    <ToggleGroupItem value="system" aria-label="System theme">
                      <Monitor className="h-4 w-4" aria-hidden="true" />
                    </ToggleGroupItem>
                    <ToggleGroupItem value="light" aria-label="Light theme">
                      <Sun className="h-4 w-4" aria-hidden="true" />
                    </ToggleGroupItem>
                    <ToggleGroupItem value="dark" aria-label="Dark theme">
                      <Moon className="h-4 w-4" aria-hidden="true" />
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
                {/* Mobile publish link */}
                {isAuthenticated && me && (
                  <div className="mt-6">
                    <Link to="/publish-skill" search={{ updateSlug: undefined }}>
                      <Button variant="primary" className="w-full">
                        <Plus className="h-4 w-4" />
                        Publish Skill
                      </Button>
                    </Link>
                  </div>
                )}
              </SheetContent>
            </Sheet>
          </div>

          {/* Desktop theme toggle */}
          <div className="theme-toggle hidden md:block" ref={toggleRef}>
            <ToggleGroup
              type="single"
              value={mode}
              onValueChange={(value) => {
                if (!value) return;
                setTheme(value as "system" | "light" | "dark");
              }}
              aria-label="Theme mode"
            >
              <ToggleGroupItem value="system" aria-label="System theme">
                <Monitor className="h-4 w-4" aria-hidden="true" />
              </ToggleGroupItem>
              <ToggleGroupItem value="light" aria-label="Light theme">
                <Sun className="h-4 w-4" aria-hidden="true" />
              </ToggleGroupItem>
              <ToggleGroupItem value="dark" aria-label="Dark theme">
                <Moon className="h-4 w-4" aria-hidden="true" />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {/* User menu / Sign in */}
          {isAuthenticated && me ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex cursor-pointer items-center gap-2 rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-2 py-1.5 text-sm font-semibold text-[color:var(--ink)] transition-colors hover:border-[color:var(--border-ui-hover)]"
                >
                  <Avatar className="h-7 w-7">
                    {avatar && (
                      <AvatarImage src={avatar} alt={me.displayName ?? me.name ?? "User avatar"} />
                    )}
                    <AvatarFallback className="text-xs">{initial}</AvatarFallback>
                  </Avatar>
                  <span className="hidden font-mono text-xs sm:inline">@{handle}</span>
                  <span className="text-xs text-[color:var(--ink-soft)]">▾</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to="/dashboard">Dashboard</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings">Settings</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void signOut()}>Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              {authError ? (
                <div
                  className="flex items-center gap-1 text-[0.85rem] text-red-600 dark:text-red-400"
                  role="alert"
                >
                  {authError}
                  <button
                    type="button"
                    onClick={clearAuthError}
                    aria-label="Dismiss"
                    className="ml-1 cursor-pointer border-none bg-transparent p-0.5 text-inherit opacity-70 hover:opacity-100"
                  >
                    &times;
                  </button>
                </div>
              ) : null}
              <SignInButton
                variant="primary"
                size="sm"
                disabled={isLoading}
              >
                <span>Sign in</span>
                <span className="hidden text-white/70 sm:inline">with GitHub</span>
              </SignInButton>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
