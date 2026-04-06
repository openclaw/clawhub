import { useAuthActions } from "@convex-dev/auth/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Github, Menu, Monitor, Moon, Search, Sun } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { getUserFacingAuthError } from "../lib/authErrorMessage";
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
  const navigate = useNavigate();

  const avatar = me?.image ?? (me?.email ? gravatarUrl(me.email) : undefined);
  const handle = me?.handle ?? me?.displayName ?? "user";
  const initial = (me?.displayName ?? me?.name ?? handle).charAt(0).toUpperCase();
  const isStaff = isModerator(me);
  const { error: authError, clear: clearAuthError } = useAuthError();
  const signInRedirectTo = getCurrentRelativeUrl();

  const [navSearchQuery, setNavSearchQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

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

  const handleNavSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = navSearchQuery.trim();
    if (!q) return;
    void navigate({
      to: "/search",
      search: { q, type: undefined },
    });
    setNavSearchQuery("");
    setMobileSearchOpen(false);
  };

  return (
    <header className="navbar">
      <div className="navbar-inner">
        {/* Row 1: Brand + Search + Actions */}
        <div className="navbar-top">
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

          <form className="navbar-search" onSubmit={handleNavSearch} role="search" aria-label="Site search">
            <Search size={16} className="navbar-search-icon" aria-hidden="true" />
            <input
              className="navbar-search-input"
              type="search"
              placeholder={isSoulMode ? "Search souls..." : "Search skills, plugins, users"}
              value={navSearchQuery}
              onChange={(e) => setNavSearchQuery(e.target.value)}
              aria-label="Search"
            />
          </form>

          <div className="nav-actions">
            <button
              className="navbar-search-mobile-trigger"
              type="button"
              aria-label="Search"
              onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
            >
              <Search size={18} aria-hidden="true" />
            </button>
            <div className="nav-mobile">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="nav-mobile-trigger" type="button" aria-label="Open menu">
                    <Menu className="h-4 w-4" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {isSoulMode ? (
                    <DropdownMenuItem asChild>
                      <a href={clawHubUrl}>ClawHub</a>
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem asChild>
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
                  </DropdownMenuItem>
                  {isSoulMode ? null : (
                    <DropdownMenuItem asChild>
                      <Link to="/plugins">Plugins</Link>
                    </DropdownMenuItem>
                  )}
                  {isSoulMode ? null : (
                    <DropdownMenuItem asChild>
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
                    </DropdownMenuItem>
                  )}
                  {isSoulMode ? null : (
                    <DropdownMenuItem asChild>
                      <Link to="/users" search={{ q: undefined }}>
                        Users
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {isSoulMode ? null : (
                    <DropdownMenuItem asChild>
                      <Link to="/about">About</Link>
                    </DropdownMenuItem>
                  )}
                  {me ? (
                    <DropdownMenuItem asChild>
                      <Link to="/stars">Stars</Link>
                    </DropdownMenuItem>
                  ) : null}
                  {me ? (
                    <DropdownMenuItem asChild>
                      <Link to="/dashboard">Dashboard</Link>
                    </DropdownMenuItem>
                  ) : null}
                  {isStaff ? (
                    <DropdownMenuItem asChild>
                      <Link to="/management" search={{ skill: undefined }}>
                        Management
                      </Link>
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setTheme("system")}>
                    <Monitor className="h-4 w-4" aria-hidden="true" />
                    System
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme("light")}>
                    <Sun className="h-4 w-4" aria-hidden="true" />
                    Light
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme("dark")}>
                    <Moon className="h-4 w-4" aria-hidden="true" />
                    Dark
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
                      setAuthError(getUserFacingAuthError(error, "Sign in failed. Please try again."));
                    });
                  }}
                >
                  <Github size={16} aria-hidden="true" />
                  <span className="sign-in-label">Sign in</span>
                  <span className="sign-in-provider">with GitHub</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Mobile search bar (expandable) */}
        {mobileSearchOpen ? (
          <form className="navbar-search-mobile" onSubmit={handleNavSearch}>
            <Search size={16} className="navbar-search-icon" aria-hidden="true" />
            <input
              className="navbar-search-input"
              type="text"
              placeholder={isSoulMode ? "Search souls..." : "Search skills, plugins, users"}
              value={navSearchQuery}
              onChange={(e) => setNavSearchQuery(e.target.value)}
              autoFocus
            />
          </form>
        ) : null}

        {/* Row 2: Content type tabs */}
        <nav className="navbar-tabs" aria-label="Content types">
          <div className="navbar-tabs-primary">
            {isSoulMode ? (
              <a href={clawHubUrl} className="navbar-tab">
                ClawHub
              </a>
            ) : null}
            {isSoulMode ? (
              <Link
                to="/souls"
                className="navbar-tab"
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
                className="navbar-tab"
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
            {isSoulMode ? null : (
              <Link to="/plugins" className="navbar-tab">
                Plugins
              </Link>
            )}
            {isSoulMode ? null : (
              <Link
                to="/souls"
                className="navbar-tab"
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
            )}
          </div>
          <div className="navbar-tabs-secondary">
            {isSoulMode ? null : (
              <Link to="/users" search={{ q: undefined }} className="navbar-tab navbar-tab-secondary">
                Users
              </Link>
            )}
            {isSoulMode ? null : (
              <Link to="/about" className="navbar-tab navbar-tab-secondary">
                About
              </Link>
            )}
            {me ? (
              <Link to="/stars" className="navbar-tab navbar-tab-secondary">
                Stars
              </Link>
            ) : null}
            {me ? (
              <Link to="/dashboard" className="navbar-tab navbar-tab-secondary">
                Dashboard
              </Link>
            ) : null}
            {isStaff ? (
              <Link
                to="/management"
                search={{ skill: undefined }}
                className="navbar-tab navbar-tab-secondary"
              >
                Manage
              </Link>
            ) : null}
          </div>
        </nav>
      </div>
    </header>
  );
}

function getCurrentRelativeUrl() {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
