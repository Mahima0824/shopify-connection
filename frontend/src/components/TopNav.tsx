import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "./primitives";
import { IconChevronDown, IconClose, IconGrid } from "./icons";
import { cn } from "@/lib/utils";
import { APP_NAV_GROUPS } from "../lib/app-nav";
import { ThemeToggle } from "../context/ThemeContext";

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(href + "/");
}

function isExact(pathname: string | null, href: string) {
  return pathname === href;
}

function isGroupActive(pathname: string | null, href?: string, children?: { href: string }[]) {
  if (href) return isActive(pathname, href);
  return (children ?? []).some((c) => isActive(pathname, c.href));
}

/* Nav items are text-first. Hover is signalled purely by a colour shift: an
   underline competed with the active item's bottom rule and read as a second,
   conflicting indicator, so it is gone. The current route alone carries a
   mark, which keeps the bar quiet and the active trail unambiguous. */
const ITEM_BASE =
  "relative inline-flex h-10 items-center rounded-lg px-3 text-sm min-[1100px]:px-3.5 font-medium whitespace-nowrap transition-all duration-300 ease-linear font-heading tracking-tight";

/* Active state is type and a rule only: primary-coloured, semibold, with a
   2px rule growing out of the item's bottom edge. No fill and no underline, so
   the current route is marked without adding any surface behind the label.
   The rule is a ::after so it can sit flush with the bar's bottom border: the
   40px item is centred in the 64px bar, so -bottom-3 lands it exactly on the
   border line. */
const ITEM_ACTIVE =
  "text-primary font-semibold px-4 min-[1100px]:px-5 after:absolute after:inset-x-3 after:-bottom-3 after:h-0.5 after:rounded-full after:bg-primary after:content-['']";

const ITEM_IDLE = "text-muted-foreground hover:text-foreground";

/* Open state mirrors the hover treatment every other item uses, so a submenu
   parent looks identical whether the pointer arrived by hover or by click,
   focus or keyboard. */
const ITEM_OPEN = "text-foreground font-semibold";

const CHEVRON =
  "size-3.5 transition-transform duration-200 ease-linear opacity-60";

/* How long the pointer may rest on a group before its panel opens, and how
   long it may leave before the panel closes. The delay on open stops the menu
   from flashing while the pointer crosses the bar toward a panel. */
const HOVER_OPEN_MS = 90;
const HOVER_CLOSE_MS = 160;

export default function TopNav() {
  const [open, setOpen] = useState(false);
  const [openDrop, setOpenDrop] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const navRef = useRef<HTMLElement>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return typeof window !== "undefined" && Boolean(localStorage.getItem("token"));
  });

  const [userEmail, setUserEmail] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem("user");
      if (raw) {
        const u = JSON.parse(raw);
        return u.email ?? null;
      }
    } catch {}
    return null;
  });

  const closeDrop = () => setOpenDrop(null);

  // Hover opens a submenu, but only after the pointer settles on it so the
  // panel does not flash while crossing the bar. Click still toggles it, so
  // touch and keyboard keep working, and focus opens it outright.
  const scheduleOpenDrop =
    (label: string, immediate = false) => () => {
      window.clearTimeout(closeTimer.current);
      window.clearTimeout(openTimer.current);
      if (immediate) {
        setOpenDrop(label);
        return;
      }
      openTimer.current = window.setTimeout(
        () => setOpenDrop(label),
        HOVER_OPEN_MS
      );
    };

  const scheduleCloseDrop = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(
      () => setOpenDrop(null),
      HOVER_CLOSE_MS
    );
  };

  // A pending hover timer must not fire after unmount or after navigating.
  useEffect(() => {
    const open = openTimer.current;
    const close = closeTimer.current;
    return () => {
      window.clearTimeout(open);
      window.clearTimeout(close);
    };
  }, []);

  // Sync auth state on route changes or storage events
  useEffect(() => {
    const syncAuth = () => {
      if (typeof window === "undefined") return;
      const tok = localStorage.getItem("token");
      setIsAuthenticated(Boolean(tok));
      try {
        const raw = localStorage.getItem("user");
        if (raw) {
          const u = JSON.parse(raw);
          setUserEmail(u.email ?? null);
        } else {
          setUserEmail(null);
        }
      } catch {
        setUserEmail(null);
      }
    };

    syncAuth();
    window.addEventListener("storage", syncAuth);
    window.addEventListener("auth-change", syncAuth);
    return () => {
      window.removeEventListener("storage", syncAuth);
      window.removeEventListener("auth-change", syncAuth);
    };
  }, [pathname]);

  const handleSignOut = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.dispatchEvent(new Event("auth-change"));
    }
    setIsAuthenticated(false);
    setUserEmail(null);
    navigate("/login");
  };

  // Close dropdown on click outside
  useEffect(() => {
    if (!openDrop) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenDrop(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [openDrop]);

  // Escape closes an open submenu, matching the ARIA disclosure pattern.
  useEffect(() => {
    if (!openDrop) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        window.clearTimeout(closeTimer.current);
        setOpenDrop(null);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [openDrop]);

  // Close dropdown and mobile drawer on page navigation
  useEffect(() => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    setOpenDrop(null);
    setOpen(false);
  }, [pathname]);

  return (
    <header
      ref={navRef}
      className="sticky top-0 z-50 w-full border-b border-border bg-background/90 backdrop-blur-md supports-[backdrop-filter]:bg-background/75"
    >
      {/* Three tracks on wide screens so the nav sits centred like the
          reference; on narrow ones the right slot collapses under the left. */}
      <div className="page-shell grid h-16 grid-cols-[1fr_auto] items-center gap-4 min-[769px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <Link
          to="/"
          className="group flex min-w-0 items-center gap-2 text-lg font-semibold font-heading tracking-tight text-foreground transition-opacity hover:opacity-80"
        >
          <span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-[13px] font-bold text-primary-foreground transition-transform duration-300 ease-linear group-hover:-rotate-6"
          >
            R
          </span>
          ReconHub
        </Link>

        {/* Desktop Primary Navigation */}
        <nav
          aria-label="Primary"
          className="hidden items-center gap-0.5 text-sm font-medium min-[769px]:flex min-[1100px]:gap-1"
        >
          {APP_NAV_GROUPS.map((g) => {
            const active = isGroupActive(pathname, g.href, g.children);
            if (g.href) {
              return (
                <Link
                  key={g.label}
                  to={g.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    ITEM_BASE,
                    active ? ITEM_ACTIVE : ITEM_IDLE,
                  )}
                >
                  {g.label}
                </Link>
              );
            }

            const dropOpen = openDrop === g.label;

            return (
              <div
                key={g.label}
                className="group relative inline-flex items-center"
                onMouseEnter={scheduleOpenDrop(g.label)}
                onMouseLeave={scheduleCloseDrop}
                onFocus={scheduleOpenDrop(g.label, true)}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    closeDrop();
                  }
                }}
              >
                <button
                  type="button"
                  aria-expanded={dropOpen}
                  aria-haspopup="true"
                  aria-label={`${g.label} submenu`}
                  onClick={() => setOpenDrop(dropOpen ? null : g.label)}
                  className={cn(
                    ITEM_BASE,
                    "gap-1 cursor-pointer",
                    active
                      ? ITEM_ACTIVE
                      : dropOpen
                        ? ITEM_OPEN
                        : ITEM_IDLE,
                  )}
                >
                  <span>{g.label}</span>
                  <svg
                    className={cn(
                      CHEVRON,
                      dropOpen && "rotate-180 opacity-100",
                    )}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {/* Floating Dropdown Panel */}
                {dropOpen && (
                  <div
                    className={cn(
                      "absolute top-full left-0 mt-2 min-w-[210px] rounded-lg border border-border bg-popover p-1.5 shadow-lg backdrop-blur-md z-50 transition-all duration-300 ease-linear animate-in fade-in-50 zoom-in-95",
                    )}
                  >
                    {(g.children ?? []).map((c) => {
                      const childActive = isExact(pathname, c.href);
                      return (
                        <Link
                          key={c.href}
                          to={c.href}
                          aria-current={childActive ? "page" : undefined}
                          onClick={closeDrop}
                          className={cn(
                            "flex h-9 items-center justify-between rounded-md px-3 text-xs whitespace-nowrap transition-colors duration-150 ease-in-out min-[1100px]:text-sm font-heading tracking-tight",
                            childActive
                              ? "bg-primary/10 text-primary font-semibold"
                              : "text-muted-foreground hover:bg-primary/10 hover:text-primary",
                          )}
                        >
                          <span>{c.label}</span>
                          {childActive && (
                            <span className="size-1.5 rounded-full bg-primary" />
                          )}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Right Action & Mobile Toggle */}
        <div className="flex items-center justify-end gap-2 sm:gap-3">
          {isAuthenticated ? (
            <div className="flex items-center gap-3">
              <span className="hidden items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium font-heading text-foreground sm:inline-flex">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {userEmail ? userEmail.split("@")[0] : "Signed in"}
              </span>
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-lg px-2 py-1 text-xs font-medium font-heading tracking-tight text-muted-foreground transition-colors duration-150 ease-in-out hover:text-destructive min-[1100px]:text-sm"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              className="rounded-lg px-2 py-1 text-xs font-medium font-heading tracking-tight text-foreground transition-colors duration-150 ease-in-out hover:text-primary min-[1100px]:text-sm"
            >
              Sign in
            </Link>
          )}
          <Button
            variant="ghost"
            size="sm"
            aria-label="menu"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="h-9 w-9 p-0 text-base min-[769px]:hidden flex items-center justify-center"
          >
            {open ? <IconClose size={18} /> : <IconGrid size={18} />}
          </Button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {open && (
        <nav aria-label="Mobile" className="border-b border-border bg-background p-4 shadow-lg min-[769px]:hidden">
          <div className="flex flex-col gap-1">
            {APP_NAV_GROUPS.map((g) => {
              if (g.href) {
                const active = isActive(pathname, g.href);
                return (
                  <Link
                    key={g.label}
                    to={g.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex min-h-10 items-center rounded-lg px-3 text-sm font-medium transition-colors duration-150 ease-in-out font-heading",
                      active
                        ? "bg-primary/10 text-primary font-semibold"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {g.label}
                  </Link>
                );
              }

              const isExpanded = expanded === g.label;
              const groupActive = isGroupActive(pathname, g.href, g.children);

              return (
                <div key={g.label} className="flex flex-col">
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => setExpanded(isExpanded ? null : g.label)}
                    className={cn(
                      "flex min-h-10 w-full items-center justify-between rounded-lg px-3 text-left text-sm font-medium transition-colors duration-150 ease-in-out font-heading",
                      groupActive
                        ? "text-foreground font-semibold"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <span>{g.label}</span>
                    <IconChevronDown size={14} className={cn("transition-transform", isExpanded && "rotate-180")} />
                  </button>
                  {isExpanded && (
                    <div className="ml-3 mt-1 flex flex-col gap-1 border-l-2 border-border/60 pl-3">
                      {(g.children ?? []).map((c) => {
                        const childActive = isExact(pathname, c.href);
                        return (
                          <Link
                            key={c.href}
                            to={c.href}
                            onClick={() => setOpen(false)}
                            className={cn(
                              "flex min-h-9 items-center justify-between rounded-md px-2 text-sm transition-colors duration-150 ease-in-out font-heading",
                              childActive
                                ? "bg-primary/10 text-primary font-semibold"
                                : "text-muted-foreground hover:bg-primary/10 hover:text-primary",
                            )}
                          >
                            <span>{c.label}</span>
                            {childActive && (
                              <span className="size-1.5 rounded-full bg-primary" />
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {isAuthenticated ? (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  handleSignOut();
                }}
                className="mt-2 block w-full rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-center text-sm font-semibold text-destructive font-heading shadow-xs hover:bg-destructive/20"
              >
                Sign out {userEmail ? `(${userEmail})` : ""}
              </button>
            ) : (
              <Link
                to="/login"
                onClick={() => setOpen(false)}
                className="mt-2 block rounded-lg bg-primary px-3 py-2 text-center text-sm font-semibold text-primary-foreground font-heading shadow-xs"
              >
                Sign in
              </Link>
            )}

            <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-heading">
                Appearance
              </span>
              <ThemeToggle showLabel />
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}