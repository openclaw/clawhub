import { useAuthActions } from "@convex-dev/auth/react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  ArrowRight,
  ExternalLink,
  ChevronDown,
  Command,
  LayoutDashboard,
  Menu,
  Monitor,
  Moon,
  MoreHorizontal,
  Search,
  Settings,
  Star,
  Sun,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import {
  getUserFacingAuthError,
  isBannedAccountAuthError,
  routeToBannedAccountPage,
} from "../lib/authErrorMessage";
import { gravatarUrl } from "../lib/gravatar";
import { PRIMARY_NAV_ITEMS, SECONDARY_NAV_ITEMS } from "../lib/nav-items";
import { buildPublisherProfileHref, buildSkillDetailHref } from "../lib/ownerRoute";
import { buildPluginDetailHref, displayPluginPackageName } from "../lib/pluginRoutes";
import { SITE_NAME } from "../lib/site";
import { applyTheme, useThemeMode } from "../lib/theme";
import { clearAuthError, setAuthError } from "../lib/useAuthError";
import { useAuthStatus } from "../lib/useAuthStatus";
import {
  useUnifiedSearch,
  type UnifiedCreatorResult,
  type UnifiedPluginResult,
  type UnifiedSkillResult,
} from "../lib/useUnifiedSearch";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { OfficialBadge } from "./OfficialBadge";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";

const THEME_MODE_ITEMS = [
  { mode: "system", label: "System theme", Icon: Monitor },
  { mode: "light", label: "Light theme", Icon: Sun },
  { mode: "dark", label: "Dark theme", Icon: Moon },
] as const;
const CLAWHUB_BRAND_MARK_SRC = "/logo-transparent.png";

function useAppleSearchShortcut() {
  const [isApple, setIsApple] = useState(true);

  useEffect(() => {
    setIsApple(/Mac|iPhone|iPad|iPod/.test(navigator.userAgent));
  }, []);

  return isApple;
}

function NavSearchShortcutKbd({ isApple }: { isApple: boolean }) {
  return (
    <kbd className="navbar-search-kbd" aria-hidden="true">
      {isApple ? (
        <>
          <Command className="navbar-search-kbd-icon" aria-hidden="true" />
          <span className="navbar-search-kbd-key">K</span>
        </>
      ) : (
        <>
          <span className="navbar-search-kbd-key">Ctrl</span>
          <span className="navbar-search-kbd-plus">+</span>
          <span className="navbar-search-kbd-key">K</span>
        </>
      )}
    </kbd>
  );
}

function GitHubLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.16 1.18.92-.26 1.9-.38 2.88-.39.98 0 1.96.13 2.88.39 2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.24 2.75.12 3.04.74.8 1.18 1.83 1.18 3.08 0 4.42-2.69 5.39-5.25 5.67.42.36.78 1.07.78 2.15 0 1.55-.01 2.8-.01 3.18 0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

type TypeaheadSection = "skills" | "plugins" | "creators";

type TypeaheadItem =
  | {
      kind: "skill";
      key: string;
      result: UnifiedSkillResult;
    }
  | {
      kind: "plugin";
      key: string;
      result: UnifiedPluginResult;
    }
  | {
      kind: "creator";
      key: string;
      result: UnifiedCreatorResult;
    }
  | {
      kind: "footer";
      key: string;
      section: TypeaheadSection;
      label: string;
    };

export default function Header() {
  const { isAuthenticated, isLoading, me } = useAuthStatus();
  const { signIn, signOut } = useAuthActions();
  const { theme, mode, setMode } = useThemeMode();
  const navigate = useNavigate();
  const location = useLocation();

  const avatar = me?.image ?? (me?.email ? gravatarUrl(me.email) : undefined);
  const rawHandle = me?.handle ?? me?.displayName ?? "user";
  const handle = rawHandle.length > 25 ? `${rawHandle.slice(0, 25)}…` : rawHandle;
  const initial = (me?.displayName ?? me?.name ?? rawHandle).charAt(0).toUpperCase();
  const isAuthResolving = isLoading || (isAuthenticated && me === undefined);
  const profileHandle = useQuery(
    api.publishers.getMyProfileHandle,
    isAuthenticated && me ? {} : "skip",
  );
  const [navSearchQuery, setNavSearchQuery] = useState("");
  const [typeaheadOpen, setTypeaheadOpen] = useState(false);
  const [typeaheadActiveIndex, setTypeaheadActiveIndex] = useState(0);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [headerScrolled, setHeaderScrolled] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const mobileSearchWrapRef = useRef<HTMLDivElement | null>(null);
  const mobileSearchTriggerRef = useRef<HTMLButtonElement | null>(null);
  const navSearchInputRef = useRef<HTMLInputElement | null>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement | null>(null);
  const isAppleSearchShortcut = useAppleSearchShortcut();
  const trimmedNavSearchQuery = navSearchQuery.trim();
  const hasNavSearchQuery = trimmedNavSearchQuery.length > 0;
  const showTypeahead = typeaheadOpen;
  const showMobileTypeahead = showTypeahead && hasNavSearchQuery;
  const {
    skillResults,
    pluginResults,
    creatorResults,
    isSearching: typeaheadSearching,
  } = useUnifiedSearch(navSearchQuery, "all", {
    debounceMs: 180,
    enabled: typeaheadOpen && hasNavSearchQuery,
    limits: { skills: 4, plugins: 4, creators: 4 },
  });
  const typeaheadSkillItems = useMemo<TypeaheadItem[]>(() => {
    if (!hasNavSearchQuery) return [];
    const items: TypeaheadItem[] = [];
    for (const result of skillResults) {
      items.push({ kind: "skill", key: `skill-${result.skill._id}`, result });
    }
    if (skillResults.length > 0) {
      items.push({
        kind: "footer",
        key: "footer-skills",
        section: "skills",
        label: `See skill results for "${trimmedNavSearchQuery}"`,
      });
    }
    return items;
  }, [hasNavSearchQuery, skillResults, trimmedNavSearchQuery]);

  const typeaheadPluginItems = useMemo<TypeaheadItem[]>(() => {
    if (!hasNavSearchQuery) return [];
    const items: TypeaheadItem[] = [];
    for (const result of pluginResults) {
      items.push({ kind: "plugin", key: `plugin-${result.plugin.name}`, result });
    }
    if (pluginResults.length > 0) {
      items.push({
        kind: "footer",
        key: "footer-plugins",
        section: "plugins",
        label: `See plugin results for "${trimmedNavSearchQuery}"`,
      });
    }
    return items;
  }, [hasNavSearchQuery, pluginResults, trimmedNavSearchQuery]);

  const typeaheadCreatorItems = useMemo<TypeaheadItem[]>(() => {
    if (!hasNavSearchQuery) return [];
    const items: TypeaheadItem[] = [];
    for (const result of creatorResults) {
      items.push({ kind: "creator", key: `creator-${result.creator._id}`, result });
    }
    if (creatorResults.length > 0) {
      items.push({
        kind: "footer",
        key: "footer-creators",
        section: "creators",
        label: `See creator results for "${trimmedNavSearchQuery}"`,
      });
    }
    return items;
  }, [creatorResults, hasNavSearchQuery, trimmedNavSearchQuery]);

  const typeaheadItems = useMemo(
    () => [...typeaheadSkillItems, ...typeaheadPluginItems, ...typeaheadCreatorItems],
    [typeaheadCreatorItems, typeaheadPluginItems, typeaheadSkillItems],
  );
  const activeTypeaheadItem = showTypeahead ? typeaheadItems[typeaheadActiveIndex] : undefined;
  const activeTypeaheadId = activeTypeaheadItem
    ? getTypeaheadOptionId(activeTypeaheadItem)
    : undefined;

  useEffect(() => {
    setTypeaheadActiveIndex(0);
  }, [trimmedNavSearchQuery]);

  useEffect(() => {
    setTypeaheadActiveIndex((index) => Math.min(index, Math.max(typeaheadItems.length - 1, 0)));
  }, [typeaheadItems.length]);

  useEffect(() => {
    if (!typeaheadOpen && !mobileSearchOpen) return () => {};
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (searchWrapRef.current?.contains(target)) return;
      if (mobileSearchWrapRef.current?.contains(target)) return;
      if (mobileSearchTriggerRef.current?.contains(target)) return;
      setTypeaheadOpen(false);
      setMobileSearchOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [typeaheadOpen, mobileSearchOpen]);

  useEffect(() => {
    const threshold = 8;
    let frame = 0;
    const update = () => {
      frame = 0;
      setHeaderScrolled(window.scrollY > threshold);
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [location.pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      if (event.defaultPrevented) return;

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }

      event.preventDefault();
      navSearchInputRef.current?.focus();
      setTypeaheadOpen(true);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const setThemeMode = (next: "system" | "light" | "dark") => {
    applyTheme(next, theme);
    setMode(next);
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
    setTypeaheadOpen(false);
    setMobileSearchOpen(false);
  };

  const navigateToTypeaheadItem = (item: TypeaheadItem) => {
    if (item.kind === "skill") {
      const resultOwnerHandle = item.result.ownerHandle?.trim();
      if (!resultOwnerHandle) {
        void navigate({
          to: "/search",
          search: { q: trimmedNavSearchQuery, type: "skills" },
        });
        setNavSearchQuery("");
        setTypeaheadOpen(false);
        setMobileSearchOpen(false);
        return;
      }
      void navigate({
        to: buildSkillDetailHref(resultOwnerHandle, item.result.skill.slug),
      });
    } else if (item.kind === "plugin") {
      void navigate({
        to: buildPluginDetailHref(item.result.plugin.name, {
          ownerHandle: item.result.plugin.ownerHandle,
        }),
      });
    } else if (item.kind === "creator") {
      const publisherHandle = item.result.creator.handle.trim();
      if (!publisherHandle) {
        void navigate({
          to: "/search",
          search: { q: trimmedNavSearchQuery, type: "creators" },
        });
        setNavSearchQuery("");
        setTypeaheadOpen(false);
        setMobileSearchOpen(false);
        return;
      }
      void navigate({
        to: buildPublisherProfileHref(publisherHandle),
      });
    } else {
      void navigate({
        to: "/search",
        search: { q: trimmedNavSearchQuery, type: item.section },
      });
    }
    setNavSearchQuery("");
    setTypeaheadOpen(false);
    setMobileSearchOpen(false);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setTypeaheadOpen(false);
      setMobileSearchOpen(false);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") {
      return;
    }
    if (!showTypeahead) {
      if (event.key === "ArrowDown" && trimmedNavSearchQuery) {
        setTypeaheadOpen(true);
        event.preventDefault();
      }
      return;
    }
    if (typeaheadItems.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setTypeaheadActiveIndex((index) => (index + 1) % typeaheadItems.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setTypeaheadActiveIndex(
        (index) => (index - 1 + typeaheadItems.length) % typeaheadItems.length,
      );
    } else if (event.key === "Enter") {
      const activeItem = typeaheadItems[typeaheadActiveIndex];
      if (!activeItem) return;
      event.preventDefault();
      navigateToTypeaheadItem(activeItem);
    }
  };

  return (
    <header className={`navbar navbar-calm${headerScrolled ? " navbar-calm-scrolled" : ""}`}>
      <div className="navbar-inner">
        <div className="navbar-top">
          <div className="navbar-calm-start">
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
                        <img
                          src={CLAWHUB_BRAND_MARK_SRC}
                          alt=""
                          aria-hidden="true"
                          className="mobile-nav-brand-mark-image"
                        />
                        <span className="mobile-nav-brand-name">{SITE_NAME}</span>
                      </span>
                    </SheetTitle>
                  </SheetHeader>
                  <div className="mobile-nav-section">
                    <SheetClose asChild>
                      <Link to="/" className="mobile-nav-link">
                        Home
                      </Link>
                    </SheetClose>
                    {PRIMARY_NAV_ITEMS.map((item) => (
                      <SheetClose key={item.to + item.label} asChild>
                        <Link
                          to={item.to}
                          search={(item.search ?? {}) as never}
                          className="mobile-nav-link"
                        >
                          {item.label}
                        </Link>
                      </SheetClose>
                    ))}
                    {SECONDARY_NAV_ITEMS.map((item) => (
                      <SheetClose key={(item.href ?? item.to ?? "") + item.label} asChild>
                        {item.href ? (
                          <a
                            href={item.href}
                            className="mobile-nav-link"
                            target="_blank"
                            rel="noreferrer"
                          >
                            <span>{item.label}</span>
                            <ExternalLink
                              size={16}
                              className="mobile-nav-link-external"
                              aria-hidden="true"
                            />
                          </a>
                        ) : (
                          <Link
                            to={item.to}
                            search={(item.search ?? {}) as never}
                            className="mobile-nav-link"
                          >
                            {item.label}
                          </Link>
                        )}
                      </SheetClose>
                    ))}
                  </div>
                  {!isAuthResolving && !isAuthenticated ? (
                    <div className="mobile-nav-section mobile-nav-appearance-section">
                      <span className="mobile-nav-section-title">Appearance</span>
                      <NavbarThemeSwitcher mode={mode} onSetMode={setThemeMode} />
                    </div>
                  ) : null}
                </SheetContent>
              </Sheet>
            </div>

            <Link
              to="/"
              search={{ q: undefined, highlighted: undefined, search: undefined }}
              className="brand"
            >
              <span className="brand-mark">
                <img
                  src={CLAWHUB_BRAND_MARK_SRC}
                  alt=""
                  aria-hidden="true"
                  className="brand-mark-image"
                />
              </span>
              <span className="brand-name brand-name-responsive">{SITE_NAME}</span>
            </Link>

            <nav className="navbar-calm-rail" aria-label="Primary navigation">
              {PRIMARY_NAV_ITEMS.map((item) => (
                <HeaderNavTab
                  key={item.to + item.label}
                  className="navbar-calm-rail-link"
                  item={item}
                  pathname={location.pathname}
                />
              ))}
              {SECONDARY_NAV_ITEMS.map((item) => (
                <HeaderNavTab
                  key={(item.href ?? item.to ?? "") + item.label}
                  className="navbar-calm-rail-link navbar-calm-rail-link-secondary"
                  item={item}
                  pathname={location.pathname}
                />
              ))}
              {SECONDARY_NAV_ITEMS.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="navbar-calm-more-trigger"
                      type="button"
                      aria-label="More navigation"
                    >
                      <MoreHorizontal size={16} aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="navbar-calm-more-menu">
                    {SECONDARY_NAV_ITEMS.map((item) => (
                      <DropdownMenuItem key={(item.href ?? item.to ?? "") + item.label} asChild>
                        <HeaderNavTab
                          className="navbar-calm-more-link"
                          item={item}
                          pathname={location.pathname}
                        />
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </nav>
          </div>

          <div className="navbar-calm-center">
            <div className="navbar-search-wrap" ref={searchWrapRef}>
              <form
                className="navbar-search"
                onSubmit={handleNavSearch}
                role="search"
                aria-label="Site search"
              >
                <Search size={16} className="navbar-search-icon" aria-hidden="true" />
                <input
                  ref={navSearchInputRef}
                  className="navbar-search-input"
                  type="search"
                  role="combobox"
                  placeholder="Search skills, plugins, and creators"
                  value={navSearchQuery}
                  onChange={(e) => {
                    setNavSearchQuery(e.target.value);
                    setTypeaheadOpen(true);
                  }}
                  onFocus={() => setTypeaheadOpen(true)}
                  onKeyDown={handleSearchKeyDown}
                  aria-label="Search"
                  aria-autocomplete="list"
                  aria-expanded={showTypeahead}
                  aria-controls="navbar-search-typeahead"
                  aria-activedescendant={activeTypeaheadId}
                  autoComplete="off"
                />
                <NavSearchShortcutKbd isApple={isAppleSearchShortcut} />
              </form>
              {showTypeahead && !mobileSearchOpen ? (
                <SearchTypeahead
                  activeIndex={typeaheadActiveIndex}
                  loading={typeaheadSearching}
                  onHoverItem={setTypeaheadActiveIndex}
                  onSelectItem={navigateToTypeaheadItem}
                  creatorItems={typeaheadCreatorItems}
                  pluginItems={typeaheadPluginItems}
                  query={trimmedNavSearchQuery}
                  skillItems={typeaheadSkillItems}
                />
              ) : null}
            </div>
          </div>

          <div className="navbar-calm-actions nav-actions">
            <button
              ref={mobileSearchTriggerRef}
              className="navbar-search-mobile-trigger"
              type="button"
              aria-label={mobileSearchOpen ? "Close search" : "Search"}
              aria-expanded={mobileSearchOpen}
              onClick={() => {
                const nextOpen = !mobileSearchOpen;
                setMobileSearchOpen(nextOpen);
                setTypeaheadOpen(nextOpen && hasNavSearchQuery);
              }}
            >
              {mobileSearchOpen ? (
                <X size={18} aria-hidden="true" />
              ) : (
                <Search size={18} aria-hidden="true" />
              )}
            </button>
            {isAuthResolving ? (
              <div className="navbar-theme-switcher-skeleton" aria-hidden="true" />
            ) : !isAuthenticated ? (
              <NavbarThemeSwitcher mode={mode} onSetMode={setThemeMode} />
            ) : null}
            {isAuthenticated && me ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="user-trigger" type="button">
                    {avatar ? (
                      <img src={avatar} alt={me.displayName ?? me.name ?? "User avatar"} />
                    ) : (
                      <span className="user-menu-fallback">{initial}</span>
                    )}
                    <span className="user-trigger-handle truncate">@{handle}</span>
                    <ChevronDown className="user-menu-chevron" size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="user-dropdown-content">
                  {profileHandle ? (
                    <DropdownMenuItem asChild>
                      <Link
                        to="/$slug"
                        params={{ slug: profileHandle }}
                        className="flex items-center gap-2"
                      >
                        <UserRound size={14} aria-hidden="true" />
                        Profile
                      </Link>
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem asChild>
                    <Link to="/dashboard" className="flex items-center gap-2">
                      <LayoutDashboard size={14} aria-hidden="true" />
                      Dashboard
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/stars" className="flex items-center gap-2">
                      <Star size={14} aria-hidden="true" />
                      Stars
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/settings" className="flex items-center gap-2">
                      <Settings size={14} aria-hidden="true" />
                      Settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <div className="user-dropdown-theme-row" role="group" aria-label="Theme">
                    {THEME_MODE_ITEMS.map(({ mode: themeMode, label, Icon }) => (
                      <DropdownMenuItem
                        key={themeMode}
                        aria-label={label}
                        aria-current={mode === themeMode ? "true" : undefined}
                        className="user-dropdown-theme-button"
                        data-status={mode === themeMode ? "active" : undefined}
                        title={label}
                        onClick={() => setThemeMode(themeMode)}
                      >
                        <Icon size={15} aria-hidden="true" />
                        <span className="sr-only">{label}</span>
                      </DropdownMenuItem>
                    ))}
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void signOut()}>Sign out</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : isAuthResolving ? (
              <div className="github-sign-in-button auth-loading-placeholder" aria-hidden="true" />
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  aria-label="Sign in with GitHub"
                  className="github-sign-in-button"
                  disabled={isLoading}
                  onClick={() => {
                    clearAuthError();
                    void signIn("github", { redirectTo: "/dashboard" })
                      .then((result) => {
                        if (result?.signingIn === false && !result.redirect) {
                          setAuthError("Sign in failed. Please try again.");
                        }
                      })
                      .catch((error) => {
                        const message = getUserFacingAuthError(
                          error,
                          "Sign in failed. Please try again.",
                        );
                        if (isBannedAccountAuthError(message)) {
                          routeToBannedAccountPage();
                          return;
                        }
                        setAuthError(message);
                      });
                  }}
                >
                  <GitHubLogo className="github-sign-in-logo" />
                  <span className="sign-in-full-copy" aria-hidden="true">
                    Sign in with GitHub
                  </span>
                  <span className="sign-in-compact-copy" aria-hidden="true">
                    Sign in
                  </span>
                </Button>
              </>
            )}
          </div>
        </div>

        {mobileSearchOpen ? (
          <button
            className="navbar-search-mobile-overlay"
            type="button"
            aria-label="Close search"
            tabIndex={-1}
            onPointerDown={() => {
              setTypeaheadOpen(false);
              setMobileSearchOpen(false);
            }}
          />
        ) : null}

        {/* Mobile search bar (expandable) */}
        {mobileSearchOpen ? (
          <div className="navbar-search-mobile-wrap" ref={mobileSearchWrapRef}>
            <form className="navbar-search-mobile" onSubmit={handleNavSearch}>
              <Search size={16} className="navbar-search-icon" aria-hidden="true" />
              <input
                ref={mobileSearchInputRef}
                className="navbar-search-input"
                type="search"
                role="combobox"
                placeholder="Search skills, plugins, and creators"
                value={navSearchQuery}
                onChange={(e) => {
                  setNavSearchQuery(e.target.value);
                  setTypeaheadOpen(true);
                }}
                onFocus={() => setTypeaheadOpen(true)}
                onKeyDown={handleSearchKeyDown}
                aria-label="Search"
                aria-autocomplete="list"
                aria-expanded={showMobileTypeahead}
                aria-controls="navbar-search-typeahead"
                aria-activedescendant={activeTypeaheadId}
                autoComplete="off"
                autoFocus
              />
              {hasNavSearchQuery ? (
                <button
                  className="navbar-search-mobile-clear"
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    setNavSearchQuery("");
                    setTypeaheadOpen(false);
                    mobileSearchInputRef.current?.focus();
                  }}
                >
                  Clear
                </button>
              ) : null}
            </form>
            {showMobileTypeahead ? (
              <SearchTypeahead
                activeIndex={typeaheadActiveIndex}
                loading={typeaheadSearching}
                onHoverItem={setTypeaheadActiveIndex}
                onSelectItem={navigateToTypeaheadItem}
                creatorItems={typeaheadCreatorItems}
                pluginItems={typeaheadPluginItems}
                query={trimmedNavSearchQuery}
                skillItems={typeaheadSkillItems}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}

type HeaderNavItem = (typeof PRIMARY_NAV_ITEMS)[number];

function HeaderNavTab({
  className,
  item,
  pathname,
}: {
  className: string;
  item: HeaderNavItem;
  pathname: string;
}) {
  const isActiveByPrefix = item.activePathPrefixes?.some((prefix) => pathname.startsWith(prefix));

  if (item.href) {
    return (
      <a
        href={item.href}
        className={className}
        data-status={isActiveByPrefix ? "active" : undefined}
      >
        {item.label}
      </a>
    );
  }

  return (
    <Link
      to={item.to}
      className={className}
      search={(item.search ?? {}) as never}
      data-status={isActiveByPrefix ? "active" : undefined}
    >
      {item.label}
    </Link>
  );
}

function SearchTypeahead({
  activeIndex,
  creatorItems,
  loading,
  onHoverItem,
  onSelectItem,
  pluginItems,
  query,
  skillItems,
}: {
  activeIndex: number;
  creatorItems: TypeaheadItem[];
  loading: boolean;
  onHoverItem: (index: number) => void;
  onSelectItem: (item: TypeaheadItem) => void;
  pluginItems: TypeaheadItem[];
  query: string;
  skillItems: TypeaheadItem[];
}) {
  const hasQuery = query.length > 0;
  const hasSkillMatches = skillItems.some((item) => item.kind === "skill");
  const hasPluginMatches = pluginItems.some((item) => item.kind === "plugin");
  const hasCreatorMatches = creatorItems.some((item) => item.kind === "creator");
  const hasMatches = hasSkillMatches || hasPluginMatches || hasCreatorMatches;
  const pluginStartIndex = skillItems.length;
  const creatorStartIndex = skillItems.length + pluginItems.length;

  return (
    <div className="navbar-search-typeahead" id="navbar-search-typeahead">
      <div className="navbar-search-typeahead-panel">
        {!hasQuery ? (
          <div className="navbar-search-typeahead-status is-empty">
            <span className="navbar-search-typeahead-status-icon" aria-hidden="true">
              <Search size={17} />
            </span>
            <span>Start typing to search skills, plugins, and creators</span>
          </div>
        ) : null}
        {hasQuery && loading && !hasMatches ? (
          <div className="navbar-search-typeahead-status">Searching...</div>
        ) : null}
        {hasQuery && !loading && !hasMatches ? (
          <div className="navbar-search-typeahead-status">
            No skills, plugins, or creators found for "{query}"
          </div>
        ) : null}
        {hasMatches ? (
          <div
            className="navbar-search-typeahead-results"
            role="listbox"
            aria-label="Search suggestions"
          >
            {hasSkillMatches ? (
              <div
                className="navbar-search-typeahead-section"
                role="group"
                aria-labelledby="navbar-search-typeahead-skills-heading"
              >
                <div
                  id="navbar-search-typeahead-skills-heading"
                  className="navbar-search-typeahead-heading"
                >
                  Skills
                </div>
                {skillItems.map((item, index) => (
                  <TypeaheadRow
                    key={item.key}
                    active={activeIndex === index}
                    item={item}
                    index={index}
                    onHoverItem={onHoverItem}
                    onSelectItem={onSelectItem}
                  />
                ))}
              </div>
            ) : null}
            {hasPluginMatches ? (
              <div
                className="navbar-search-typeahead-section"
                role="group"
                aria-labelledby="navbar-search-typeahead-plugins-heading"
              >
                <div
                  id="navbar-search-typeahead-plugins-heading"
                  className="navbar-search-typeahead-heading"
                >
                  Plugins
                </div>
                {pluginItems.map((item, index) => (
                  <TypeaheadRow
                    key={item.key}
                    active={activeIndex === pluginStartIndex + index}
                    item={item}
                    index={pluginStartIndex + index}
                    onHoverItem={onHoverItem}
                    onSelectItem={onSelectItem}
                  />
                ))}
              </div>
            ) : null}
            {hasCreatorMatches ? (
              <div
                className="navbar-search-typeahead-section"
                role="group"
                aria-labelledby="navbar-search-typeahead-creators-heading"
              >
                <div
                  id="navbar-search-typeahead-creators-heading"
                  className="navbar-search-typeahead-heading"
                >
                  Creators
                </div>
                {creatorItems.map((item, index) => (
                  <TypeaheadRow
                    key={item.key}
                    active={activeIndex === creatorStartIndex + index}
                    item={item}
                    index={creatorStartIndex + index}
                    onHoverItem={onHoverItem}
                    onSelectItem={onSelectItem}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TypeaheadRow({
  active,
  index,
  item,
  onHoverItem,
  onSelectItem,
}: {
  active: boolean;
  index: number;
  item: TypeaheadItem;
  onHoverItem: (index: number) => void;
  onSelectItem: (item: TypeaheadItem) => void;
}) {
  const rowRef = useRef<HTMLButtonElement | null>(null);
  const body = getTypeaheadRowBody(item);

  useEffect(() => {
    if (!active) return;
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <button
      ref={rowRef}
      id={getTypeaheadOptionId(item)}
      className={`navbar-search-typeahead-row${active ? " is-active" : ""}${item.kind === "footer" ? " is-footer" : ""}`}
      type="button"
      role="option"
      aria-selected={active}
      onMouseEnter={() => onHoverItem(index)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onSelectItem(item)}
    >
      <TypeaheadRowIcon item={item} />
      <span className="navbar-search-typeahead-copy">
        <span className="navbar-search-typeahead-title">{body.title}</span>
        {body.meta ? <span className="navbar-search-typeahead-meta">{body.meta}</span> : null}
      </span>
      {item.kind === "footer" ? <ArrowRight size={14} aria-hidden="true" /> : null}
    </button>
  );
}

function getTypeaheadOptionId(item: TypeaheadItem) {
  return `navbar-search-typeahead-${item.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function TypeaheadRowIcon({ item }: { item: TypeaheadItem }) {
  if (item.kind === "skill") {
    const label = item.result.skill.displayName || item.result.skill.slug;
    return (
      <span className="navbar-search-typeahead-icon" aria-hidden="true">
        <MarketplaceIcon kind="skill" label={label} skill={item.result.skill} size="xs" />
      </span>
    );
  }

  if (item.kind === "plugin") {
    const label = item.result.plugin.displayName || item.result.plugin.name;
    return (
      <span className="navbar-search-typeahead-icon" aria-hidden="true">
        <MarketplaceIcon
          kind="plugin"
          label={label}
          categorySlug={item.result.plugin.categories?.[0]}
          size="xs"
        />
      </span>
    );
  }

  if (item.kind === "creator") {
    const publisher = item.result.creator;
    return (
      <span className="navbar-search-typeahead-icon" aria-hidden="true">
        <MarketplaceIcon
          kind={publisher.kind === "org" ? "org" : "user"}
          label={publisher.displayName}
          imageUrl={publisher.image}
          size="xs"
        />
      </span>
    );
  }

  return null;
}

function getTypeaheadRowBody(item: TypeaheadItem) {
  if (item.kind === "skill") {
    const owner = item.result.ownerHandle ? `@${item.result.ownerHandle}` : "Skill";
    return {
      title: item.result.skill.displayName,
      meta: (
        <TypeaheadPublisherMeta
          owner={owner}
          official={item.result.owner?.official === true}
          packageName={item.result.skill.slug}
        />
      ),
    };
  }
  if (item.kind === "plugin") {
    const packageName = displayPluginPackageName(item.result.plugin.name);
    const owner = item.result.plugin.ownerHandle ? `@${item.result.plugin.ownerHandle}` : null;
    return {
      title: item.result.plugin.displayName,
      meta: owner ? (
        <TypeaheadPublisherMeta
          owner={owner}
          official={item.result.plugin.isOfficial}
          packageName={packageName}
        />
      ) : (
        packageName
      ),
    };
  }
  if (item.kind === "creator") {
    const publisher = item.result.creator;
    return {
      title: publisher.displayName,
      meta: (
        <TypeaheadCreatorMeta
          handle={`@${publisher.handle}`}
          official={publisher.official === true}
        />
      ),
    };
  }
  return {
    title: item.label,
    meta: null,
  };
}

function TypeaheadPublisherMeta({
  owner,
  official,
  packageName,
}: {
  owner: string;
  official: boolean;
  packageName: string;
}) {
  return (
    <>
      <span className="navbar-search-typeahead-publisher">{owner}</span>
      {official ? <OfficialBadge /> : null}
      <span className="navbar-search-typeahead-separator"> / </span>
      <span className="navbar-search-typeahead-package">{packageName}</span>
    </>
  );
}

function TypeaheadCreatorMeta({ handle, official }: { handle: string; official: boolean }) {
  return (
    <>
      <span className="navbar-search-typeahead-publisher">{handle}</span>
      {official ? <OfficialBadge /> : null}
    </>
  );
}
function NavbarThemeSwitcher({
  mode,
  onSetMode,
}: {
  mode: (typeof THEME_MODE_ITEMS)[number]["mode"];
  onSetMode: (mode: (typeof THEME_MODE_ITEMS)[number]["mode"]) => void;
}) {
  return (
    <div className="navbar-theme-switcher" role="group" aria-label="Theme mode">
      {THEME_MODE_ITEMS.map(({ mode: themeMode, label, Icon }) => (
        <button
          key={themeMode}
          type="button"
          className={`navbar-theme-switcher-btn${mode === themeMode ? " is-active" : ""}`}
          aria-label={label}
          aria-pressed={mode === themeMode}
          title={label}
          onClick={(event) => {
            onSetMode(themeMode);
            event.currentTarget.blur();
          }}
        >
          <Icon size={16} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
