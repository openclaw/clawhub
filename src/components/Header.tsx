import { useAuthActions } from "@convex-dev/auth/react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Ghost, Github, Menu, Monitor, Moon, Plug, Search, Sun, Wrench } from "lucide-react";
import { type ComponentType, useMemo, useRef, useState } from "react";
import { getUserFacingAuthError } from "../lib/authErrorMessage";
import { gravatarUrl } from "../lib/gravatar";
import {
  filterNavItems,
  type NavIconName,
  PRIMARY_NAV_ITEMS,
  SECONDARY_NAV_ITEMS,
} from "../lib/nav-items";
import { isModerator } from "../lib/roles";
import { getClawHubSiteUrl, getSiteMode, getSiteName } from "../lib/site";
import { applyTheme, THEME_OPTIONS, useThemeMode } from "../lib/theme";
import { startThemeTransition } from "../lib/theme-transition";
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
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

const NAV_ICONS: Record<NavIconName, ComponentType<{ size?: number; className?: string }>> = {
  wrench: Wrench,
  plug: Plug,
  ghost: Ghost,
};

const THEME_FAMILY_ICONS: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  claw: Ghost,
  hub: Plug,
};

const THEME_MODE_SEQUENCE: Array<"system" | "light" | "dark"> = ["system", "light", "dark"];

export default function Header() {
  const { isAuthenticated, isLoading, me } = useAuthStatus();
  const { signIn, signOut } = useAuthActions();
  const { theme, mode, setMode, setTheme } = useThemeMode();
  const toggleRef = useRef<HTMLDivElement | null>(null);
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
  const secondaryItems = useMemo(() => filterNavItems(SECONDARY_NAV_ITEMS, navCtx), [navCtx]);
  const { error: authError, clear: clearAuthError } = useAuthError();
  const signInRedirectTo = getCurrentRelativeUrl();

  const [navSearchQuery, setNavSearchQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const themeLabel = THEME_OPTIONS.find((option) => option.value === theme)?.label ?? "Claw";
  const ThemeFamilyIcon = THEME_FAMILY_ICONS[theme] ?? Wrench;
  const ThemeModeIcon = getThemeModeIcon(mode);

  const setThemeMode = (next: "system" | "light" | "dark") => {
    startThemeTransition({
      nextTheme: next,
      currentTheme: mode,
      setTheme: (value) => {
        const nextMode = value as "system" | "light" | "dark";
        applyTheme(nextMode, theme);
        setMode(nextMode);
      },
      context: { element: toggleRef.current },
    });
  };

  const setThemeFamily = (nextTheme: string) => {
    applyTheme(mode, nextTheme);
    setTheme(nextTheme);
  };

  const cycleThemeFamily = () => {
    const currentIndex = Math.max(
      0,
      THEME_OPTIONS.findIndex((option) => option.value === theme),
    );
    const nextTheme = THEME_OPTIONS[(currentIndex + 1) % THEME_OPTIONS.length]?.value ?? "claw";
    setThemeFamily(nextTheme);
  };

  const cycleThemeMode = () => {
    const currentIndex = Math.max(0, THEME_MODE_SEQUENCE.indexOf(mode));
    const nextMode = THEME_MODE_SEQUENCE[(currentIndex + 1) % THEME_MODE_SEQUENCE.length] ?? "system";
    setThemeMode(nextMode);
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
                  <SheetTitle>{siteName}</SheetTitle>
                  <SheetDescription>
                    Browse sections, switch theme, and access account actions.
                  </SheetDescription>
                </SheetHeader>
                <div className="mobile-nav-section">
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
                  {secondaryItems.map((item) => (
                    <SheetClose key={item.to + item.label} asChild>
                      <Link to={item.to} search={item.search ?? {}} className="mobile-nav-link">
                        {item.label === "Management" ? "Manage" : item.label}
                      </Link>
                    </SheetClose>
                  ))}
                </div>
                <div className="mobile-nav-section">
                  <div className="mobile-nav-section-title">Theme family</div>
                  {THEME_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      className="mobile-nav-link"
                      type="button"
                      onClick={() => {
                        setThemeFamily(option.value);
                        setMobileMenuOpen(false);
                      }}
                    >
                      <span>{option.label}</span>
                      {theme === option.value ? <span className="mobile-nav-meta">Selected</span> : null}
                    </button>
                  ))}
                </div>
                <div className="mobile-nav-section">
                  <div className="mobile-nav-section-title">Theme mode</div>
                  <button
                    className="mobile-nav-link"
                    type="button"
                    onClick={() => {
                      setThemeMode("system");
                      setMobileMenuOpen(false);
                    }}
                  >
                    <Monitor className="h-4 w-4" aria-hidden="true" />
                    System
                  </button>
                  <button
                    className="mobile-nav-link"
                    type="button"
                    onClick={() => {
                      setThemeMode("light");
                      setMobileMenuOpen(false);
                    }}
                  >
                    <Sun className="h-4 w-4" aria-hidden="true" />
                    Light
                  </button>
                  <button
                    className="mobile-nav-link"
                    type="button"
                    onClick={() => {
                      setThemeMode("dark");
                      setMobileMenuOpen(false);
                    }}
                  >
                    <Moon className="h-4 w-4" aria-hidden="true" />
                    Dark
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
            <div className="theme-toggle" ref={toggleRef}>
              <div className="theme-picker-desktop" aria-label={`Theme family, current ${themeLabel}`}>
                <div className="theme-family-toggle" role="group" aria-label="Theme family">
                  {THEME_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className="theme-family-button"
                      data-state={theme === option.value ? "on" : "off"}
                      aria-pressed={theme === option.value}
                      onClick={() => setThemeFamily(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="theme-cycle-group" aria-label="Theme controls">
                <button
                  type="button"
                  className="theme-cycle-button theme-cycle-button-family"
                  onClick={cycleThemeFamily}
                  aria-label={`Cycle theme family. Current: ${themeLabel}`}
                  title={`Theme family: ${themeLabel}`}
                >
                  <ThemeFamilyIcon className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="theme-cycle-button theme-cycle-button-mode"
                  onClick={cycleThemeMode}
                  aria-label={`Cycle theme mode. Current: ${mode}`}
                  title={`Theme mode: ${mode}`}
                >
                  <ThemeModeIcon className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <ToggleGroup
                className="theme-mode-toggle"
                type="single"
                value={mode}
                onValueChange={(value) => {
                  if (!value) return;
                  setThemeMode(value as "system" | "light" | "dark");
                }}
                aria-label={`Theme mode, ${themeLabel} preset`}
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
                      setAuthError(getUserFacingAuthError(error, "Sign in failed. Please try again."));
                    });
                  }}
                >
                  <Github size={16} aria-hidden="true" />
                  <span className="sign-in-label">Sign in</span>
                  <span className="sign-in-provider">with GitHub</span>
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

        {/* Row 2: Content type tabs */}
        <nav className="navbar-tabs" aria-label="Content types">
          <div className="navbar-tabs-primary">
            {isSoulMode ? (
              <a href={clawHubUrl} className="navbar-tab">
                ClawHub
              </a>
            ) : null}
            {primaryItems.map((item) => {
              const Icon = item.icon ? NAV_ICONS[item.icon] : null;
              const isActiveByPrefix = item.activePathPrefixes?.some((prefix) =>
                location.pathname.startsWith(prefix)
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
          </div>
          <div className="navbar-tabs-secondary">
            {secondaryItems.map((item) => {
              const isActiveByPrefix = item.activePathPrefixes?.some((prefix) =>
                location.pathname.startsWith(prefix)
              );
              return (
                <Link
                  key={item.to + item.label}
                  to={item.to}
                  search={item.search ?? {}}
                  className="navbar-tab navbar-tab-secondary"
                  data-status={isActiveByPrefix ? "active" : undefined}
                >
                  {item.label === "Management" ? "Manage" : item.label}
                </Link>
              );
            })}
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

function getThemeModeIcon(mode: "system" | "light" | "dark") {
  switch (mode) {
    case "light":
      return Sun;
    case "dark":
      return Moon;
    case "system":
    default:
      return Monitor;
  }
}
