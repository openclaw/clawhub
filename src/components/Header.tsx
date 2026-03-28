import { useAuthActions } from "@convex-dev/auth/react";
import { Link } from "@tanstack/react-router";
import { Menu, Monitor, Moon, Sun, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { getUserFacingConvexError } from "../lib/convexError";
import { gravatarUrl } from "../lib/gravatar";
import { isModerator } from "../lib/roles";
import { getClawHubSiteUrl, getSiteMode, getSiteName } from "../lib/site";
import { applyTheme, useThemeMode } from "../lib/theme";
import { startThemeTransition } from "../lib/theme-transition";
import { setAuthError, useAuthError } from "../lib/useAuthError";
import { useAuthStatus } from "../lib/useAuthStatus";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "./ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

export default function Header() {
  const { isAuthenticated, isLoading, me } = useAuthStatus();
  const { signIn, signOut } = useAuthActions();
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
  const signInRedirectTo = getCurrentRelativeUrl();

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

  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <Link
          to="/"
          search={{ q: undefined, highlighted: undefined, search: undefined }}
          className="brand"
        >
          <span className="brand-mark">
            <img src="/clawd-logo.png" alt="" aria-hidden="true" />
          </span>
          <span className="brand-name">{siteName}</span>
        </Link>
        <nav className="nav-links">
          {isSoulMode ? <a href={clawHubUrl}>ClawHub</a> : null}
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
            >
              Skills
            </Link>
          )}
          {isSoulMode ? null : <Link to="/packages">Packages</Link>}
          <Link to="/upload" search={{ updateSlug: undefined }}>
            Upload
          </Link>
          {isSoulMode ? null : <Link to="/import">Import</Link>}
          <Link
            to={isSoulMode ? "/souls" : "/skills"}
            search={
              isSoulMode
                ? {
                    q: undefined,
                    sort: undefined,
                    dir: undefined,
                    view: undefined,
                    focus: "search",
                  }
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
          >
            Search
          </Link>
          {me ? <Link to="/stars">Stars</Link> : null}
          {isStaff ? (
            <Link to="/management" search={{ skill: undefined }}>
              Management
            </Link>
          ) : null}
        </nav>
        <div className="nav-actions">
          <div className="nav-mobile">
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <button className="nav-mobile-trigger" type="button" aria-label="Open menu">
                  <Menu className="h-4 w-4" aria-hidden="true" />
                </button>
              </SheetTrigger>
              <SheetContent aria-describedby={undefined}>
                <SheetTitle className="sr-only">Navigation menu</SheetTitle>
                {isAuthenticated && me ? (
                  <div className="mobile-sheet-user">
                    <div className="mobile-sheet-user-avatar">
                      {avatar ? (
                        <img src={avatar} alt={me.displayName ?? me.name ?? "User avatar"} />
                      ) : (
                        <span>{initial}</span>
                      )}
                    </div>
                    <div className="mobile-sheet-user-info">
                      <div className="mobile-sheet-user-name">
                        {me.displayName ?? me.name ?? handle}
                      </div>
                      <div className="mobile-sheet-user-handle">@{handle}</div>
                    </div>
                    <SheetClose asChild>
                      <button
                        className="mobile-sheet-close"
                        type="button"
                        aria-label="Close menu"
                        style={{ marginLeft: "auto" }}
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </SheetClose>
                  </div>
                ) : (
                  <div className="mobile-sheet-header">
                    <span
                      className="brand-name"
                      style={{ fontFamily: "var(--font-display)", fontSize: "1.1rem" }}
                    >
                      {siteName}
                    </span>
                    <SheetClose asChild>
                      <button className="mobile-sheet-close" type="button" aria-label="Close menu">
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </SheetClose>
                  </div>
                )}

                <nav className="mobile-sheet-nav">
                  {isSoulMode ? (
                    <a
                      href={clawHubUrl}
                      className="mobile-sheet-nav-item"
                      onClick={() => setSheetOpen(false)}
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
                      className="mobile-sheet-nav-item"
                      onClick={() => setSheetOpen(false)}
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
                      className="mobile-sheet-nav-item"
                      onClick={() => setSheetOpen(false)}
                    >
                      Skills
                    </Link>
                  )}
                  {isSoulMode ? null : (
                    <Link
                      to="/packages"
                      className="mobile-sheet-nav-item"
                      onClick={() => setSheetOpen(false)}
                    >
                      Packages
                    </Link>
                  )}
                  <Link
                    to="/upload"
                    search={{ updateSlug: undefined }}
                    className="mobile-sheet-nav-item"
                    onClick={() => setSheetOpen(false)}
                  >
                    Upload
                  </Link>
                  {isSoulMode ? null : (
                    <Link
                      to="/import"
                      className="mobile-sheet-nav-item"
                      onClick={() => setSheetOpen(false)}
                    >
                      Import
                    </Link>
                  )}
                  <Link
                    to={isSoulMode ? "/souls" : "/skills"}
                    search={
                      isSoulMode
                        ? {
                            q: undefined,
                            sort: undefined,
                            dir: undefined,
                            view: undefined,
                            focus: "search",
                          }
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
                    className="mobile-sheet-nav-item"
                    onClick={() => setSheetOpen(false)}
                  >
                    Search
                  </Link>
                  {me ? (
                    <Link
                      to="/stars"
                      className="mobile-sheet-nav-item"
                      onClick={() => setSheetOpen(false)}
                    >
                      Stars
                    </Link>
                  ) : null}
                  {isStaff ? (
                    <Link
                      to="/management"
                      search={{ skill: undefined }}
                      className="mobile-sheet-nav-item"
                      onClick={() => setSheetOpen(false)}
                    >
                      Management
                    </Link>
                  ) : null}

                  {isAuthenticated && me ? (
                    <div className="mobile-sheet-section">
                      <div className="mobile-sheet-section-label">Account</div>
                      <Link
                        to="/dashboard"
                        className="mobile-sheet-nav-item"
                        onClick={() => setSheetOpen(false)}
                      >
                        Dashboard
                      </Link>
                      <Link
                        to="/settings"
                        className="mobile-sheet-nav-item"
                        onClick={() => setSheetOpen(false)}
                      >
                        Settings
                      </Link>
                      <button
                        type="button"
                        className="mobile-sheet-nav-item"
                        onClick={() => {
                          setSheetOpen(false);
                          void signOut();
                        }}
                        style={{
                          width: "100%",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        Sign out
                      </button>
                    </div>
                  ) : null}
                </nav>

                <div className="mobile-sheet-footer">
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
                      <span className="sr-only">System</span>
                    </ToggleGroupItem>
                    <ToggleGroupItem value="light" aria-label="Light theme">
                      <Sun className="h-4 w-4" aria-hidden="true" />
                      <span className="sr-only">Light</span>
                    </ToggleGroupItem>
                    <ToggleGroupItem value="dark" aria-label="Dark theme">
                      <Moon className="h-4 w-4" aria-hidden="true" />
                      <span className="sr-only">Dark</span>
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
              </SheetContent>
            </Sheet>
          </div>
          <div className="theme-toggle" ref={toggleRef}>
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
                <span className="sr-only">System</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="light" aria-label="Light theme">
                <Sun className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Light</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="dark" aria-label="Dark theme">
                <Moon className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Dark</span>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          {isAuthenticated && me ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="user-trigger" type="button">
                  {avatar ? (
                    <img src={avatar} alt={me.displayName ?? me.name ?? "User avatar"} />
                  ) : (
                    <span className="user-menu-fallback">{initial}</span>
                  )}
                  <span className="mono">@{handle}</span>
                  <span className="user-menu-chevron">▾</span>
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
                <div className="error" role="alert" style={{ fontSize: "0.85rem", marginRight: 8 }}>
                  {authError}{" "}
                  <button
                    type="button"
                    onClick={clearAuthError}
                    aria-label="Dismiss"
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "inherit",
                      padding: "0 2px",
                    }}
                  >
                    &times;
                  </button>
                </div>
              ) : null}
              <button
                className="btn btn-primary"
                type="button"
                disabled={isLoading}
                onClick={() => {
                  clearAuthError();
                  void signIn(
                    "github",
                    signInRedirectTo ? { redirectTo: signInRedirectTo } : undefined,
                  ).catch((error) => {
                    setAuthError(
                      getUserFacingConvexError(error, "Sign in failed. Please try again."),
                    );
                  });
                }}
              >
                <span className="sign-in-label">Sign in</span>
                <span className="sign-in-provider">with GitHub</span>
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function getCurrentRelativeUrl() {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
