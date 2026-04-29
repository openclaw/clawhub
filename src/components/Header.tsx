import { useAuthActions } from "@convex-dev/auth/react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Ghost, Menu, Moon, Plug, Search, Sun, Wrench } from "lucide-react";
import { type ComponentType, useMemo, useState } from "react";
import { getUserFacingAuthError } from "../lib/authErrorMessage";
import { gravatarUrl } from "../lib/gravatar";
import { filterNavItems, type NavIconName, PRIMARY_NAV_ITEMS } from "../lib/nav-items";
import { isModerator } from "../lib/roles";
import { getClawHubSiteUrl, getSiteMode, getSiteName } from "../lib/site";
import { applyTheme, useThemeMode } from "../lib/theme";
import { setAuthError, useAuthError } from "../lib/useAuthError";
import { useAuthStatus } from "../lib/useAuthStatus";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";

const NAV_ICONS: Record<NavIconName, ComponentType<{ size?: number; className?: string }>> = {
  wrench: Wrench,
  plug: Plug,
  ghost: Ghost,
};

export default function Header() {
  const { isAuthenticated, isLoading, me } = useAuthStatus();
  const { signIn, signOut } = useAuthActions();
  const { theme, mode, setMode } = useThemeMode();
  const siteMode = getSiteMode();
  const siteName = useMemo(() => getSiteName(siteMode), [siteMode]);
  const isSoulMode = siteMode === "souls";
  const clawHubUrl = getClawHubSiteUrl();
  const navigate = useNavigate();
  const location = useLocation();

  const avatar = me?.image ?? (me?.email ? gravatarUrl(me.email) : undefined);
  const handle = me?.handle ?? me?.displayName ?? "user";
  const initial = (me?.displayName ?? me?.name ?? handle).charAt(0).toUpperCase();
  const isStaff = isModerator(me);
  const hasResolvedUser = Boolean(me);
  const navCtx = useMemo(
    () => ({ isSoulMode, isAuthenticated: hasResolvedUser, isStaff }),
    [hasResolvedUser, isSoulMode, isStaff],
  );
  const primaryItems = useMemo(() => filterNavItems(PRIMARY_NAV_ITEMS, navCtx), [navCtx]);
  const { error: authError, clear: clearAuthError } = useAuthError();
  const signInRedirectTo = getCurrentRelativeUrl();

  const [navSearchQuery, setNavSearchQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const ThemeModeIcon = getThemeModeIcon(mode);
  const nextThemeMode = getNextThemeMode(mode);

  const setThemeMode = (next: "system" | "light" | "dark") => {
    applyTheme(next, theme);
    setMode(next);
  };

  const handleNavSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = navSearchQuery.trim();
    if (!q) return;
    void navigate({
      to: isSoulMode ? "/souls" : "/search",
      search: isSoulMode
        ? {
            q,
            sort: undefined,
            dir: undefined,
            view: undefined,
            focus: undefined,
          }
        : { q, type: undefined },
    });
    setNavSearchQuery("");
    setMobileSearchOpen(false);
  };

  return (
    <header className="navbar">
      <div className="navbar-inner">
        {/* Row 1: Brand + Search + Actions */}
        <div className="navbar-top">
          <div className="nav-mobile">
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <button
                className="nav-mobile-trigger"
                type="button"
                aria-label="Open menu"
                onClick={() => setMobileMenuOpen(true)}
              >
                <Menu className="h-4 w-4" aria-hidden="true" />
              </button>
              <SheetContent side="left" className="mobile-nav-sheet">
                <SheetHeader className="pr-10">
                  <SheetTitle>
                    <span className="mobile-nav-brand">
                      <span className="mobile-nav-brand-mark" aria-hidden="true">
                        <img
                          src="/clawd-logo.png"
                          alt=""
                          aria-hidden="true"
                          className="mobile-nav-brand-mark-image"
                        />
                      </span>
                      <span className="mobile-nav-brand-name">{siteName}</span>
                    </span>
                  </SheetTitle>
                  <SheetDescription>
                    Browse sections, switch theme, and access account actions.
                  </SheetDescription>
                </SheetHeader>
                <div className="mobile-nav-section">
                  <SheetClose asChild>
                    <Link to="/" className="mobile-nav-link">
                      Home
                    </Link>
                  </SheetClose>
                  {isSoulMode ? (
                    <SheetClose asChild>
                      <a href={clawHubUrl} className="mobile-nav-link">
                        ClawHub
                      </a>
                    </SheetClose>
                  ) : null}
                  {primaryItems.map((item) => (
                    <SheetClose key={item.to + item.label} asChild>
                      <Link to={item.to} search={item.search ?? {}} className="mobile-nav-link">
                        {item.label}
                      </Link>
                    </SheetClose>
                  ))}
                </div>
                <div className="mobile-nav-section">
                  <div className="mobile-nav-section-title">Theme</div>
                  <button
                    className="mobile-nav-link"
                    type="button"
                    onClick={() => {
                      setThemeMode(nextThemeMode);
                      setMobileMenuOpen(false);
                    }}
                  >
                    <ThemeModeIcon className="h-4 w-4" aria-hidden="true" />
                    {mode === "system" ? "System theme" : `${mode} theme`}
                  </button>
                </div>
              </SheetContent>
            </Sheet>
          </div>

          <Link
            to="/"
            search={{ q: undefined, highlighted: undefined, search: undefined }}
            className="brand"
          >
            <span className="brand-mark">
              <img src="/clawd-logo.png" alt="" aria-hidden="true" className="brand-mark-image" />
            </span>
            <span className="brand-name brand-name-responsive">{siteName}</span>
          </Link>

          <form
            className="navbar-search"
            onSubmit={handleNavSearch}
            role="search"
            aria-label="Site search"
          >
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

          <nav className="navbar-top-links" aria-label="Primary">
            {isSoulMode ? (
              <a href={clawHubUrl} className="navbar-tab">
                ClawHub
              </a>
            ) : null}
            {primaryItems.map((item) => {
              const Icon = item.icon ? NAV_ICONS[item.icon] : null;
              const isActiveByPrefix = item.activePathPrefixes?.some((prefix) =>
                location.pathname.startsWith(prefix),
              );
              return (
                <Link
                  key={item.to + item.label}
                  to={item.to}
                  className="navbar-tab"
                  search={item.search ?? {}}
                  data-status={isActiveByPrefix ? "active" : undefined}
                >
                  {Icon ? <Icon size={14} className="opacity-50" aria-hidden="true" /> : null}
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="nav-actions">
            <button
              className="navbar-search-mobile-trigger"
              type="button"
              aria-label="Search"
              onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
            >
              <Search size={18} aria-hidden="true" />
            </button>
            <div className="theme-toggle">
              <button
                type="button"
                className="theme-cycle-button"
                onClick={() => setThemeMode(nextThemeMode)}
                aria-label={`Toggle theme. Current: ${mode}`}
                title={`Theme: ${mode}`}
              >
                <ThemeModeIcon className="h-4 w-4" aria-hidden="true" />
              </button>
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
                    <Link to="/stars">Stars</Link>
                  </DropdownMenuItem>
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
                  <div className="error mr-2 text-[0.85rem]" role="alert">
                    {authError}{" "}
                    <button
                      type="button"
                      onClick={clearAuthError}
                      aria-label="Dismiss"
                      className="cursor-pointer border-none bg-transparent px-0.5 py-0 text-inherit"
                    >
                      &times;
                    </button>
                  </div>
                ) : null}
                <Button
                  variant="primary"
                  size="sm"
                  type="button"
                  disabled={isLoading}
                  onClick={() => {
                    clearAuthError();
                    void signIn(
                      "github",
                      signInRedirectTo ? { redirectTo: signInRedirectTo } : undefined,
                    ).catch((error) => {
                      setAuthError(
                        getUserFacingAuthError(error, "Sign in failed. Please try again."),
                      );
                    });
                  }}
                >
                  Sign In
                </Button>
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
      </div>
    </header>
  );
}

function getCurrentRelativeUrl() {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function getThemeModeIcon(mode: "system" | "light" | "dark") {
  switch (mode) {
    case "light":
      return Sun;
    case "dark":
      return Moon;
    case "system":
    default:
      return Sun;
  }
}

function getResolvedThemeMode(): "light" | "dark" {
  if (typeof document !== "undefined") {
    const resolved = document.documentElement.dataset.themeResolved;
    if (resolved === "light" || resolved === "dark") return resolved;
  }
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

function getNextThemeMode(mode: "system" | "light" | "dark"): "light" | "dark" {
  const resolved = mode === "system" ? getResolvedThemeMode() : mode;
  return resolved === "dark" ? "light" : "dark";
}
