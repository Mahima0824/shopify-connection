import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "./primitives";
import { cn } from "@/lib/utils";
import { APP_NAV_GROUPS } from "../lib/app-nav";

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

const PILL =
  "inline-flex h-9 items-center rounded-full px-3 text-xs min-[1100px]:text-sm min-[1100px]:px-3.5 font-medium whitespace-nowrap transition-all duration-150";

export default function TopNav() {
  const [open, setOpen] = useState(false);
  const [openDrop, setOpenDrop] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { pathname } = useLocation();

  const closeDrop = () => setOpenDrop(null);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/80 bg-background/95 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-[1280px] items-center justify-between px-4 sm:px-6">
        <Link
          to="/"
          className="flex items-center gap-2 text-base font-bold tracking-tight text-foreground transition-opacity hover:opacity-85"
        >
          ReconHub
        </Link>

        {/* Desktop Primary Navigation - NO overflow-x-auto to prevent scrollbar */}
        <nav
          aria-label="Primary"
          className="hidden items-center gap-1 text-sm font-medium min-[769px]:flex min-[1100px]:gap-1.5"
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
                    PILL,
                    active
                      ? "bg-foreground text-background font-semibold shadow-xs rounded-full"
                      : "text-muted-foreground hover:bg-primary/10 hover:text-primary rounded-full",
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
                onMouseEnter={() => setOpenDrop(g.label)}
                onMouseLeave={() => setOpenDrop(null)}
              >
                <button
                  type="button"
                  aria-expanded={dropOpen}
                  aria-haspopup="true"
                  aria-label={`${g.label} menu`}
                  onClick={() => setOpenDrop(dropOpen ? null : g.label)}
                  className={cn(
                    PILL,
                    "gap-1 cursor-pointer rounded-full",
                    active
                      ? "bg-foreground text-background font-semibold shadow-xs"
                      : "text-muted-foreground hover:bg-primary/10 hover:text-primary",
                  )}
                >
                  <span>{g.label}</span>
                  <svg
                    className={cn(
                      "size-3.5 transition-transform duration-200 opacity-70",
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

                {/* Floating Dropdown Panel - Escapes navbar cleanly without clipping */}
                <div
                  className={cn(
                    "absolute top-full left-0 mt-1 min-w-[210px] rounded-xl border border-border/80 bg-popover/98 p-1.5 shadow-xl backdrop-blur-md z-50 transition-all duration-150",
                    "before:absolute before:-top-3 before:left-0 before:right-0 before:h-3 before:content-['']",
                    dropOpen
                      ? "opacity-100 visible translate-y-0 pointer-events-auto"
                      : "opacity-0 invisible -translate-y-1 pointer-events-none group-hover:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:pointer-events-auto",
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
                          "flex h-9 items-center justify-between rounded-lg px-3 text-xs font-medium whitespace-nowrap transition-colors min-[1100px]:text-sm",
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
              </div>
            );
          })}
        </nav>

        {/* Right Action & Mobile Toggle */}
        <div className="flex items-center gap-3">
          <Link
            to="/login"
            className="text-xs font-semibold text-foreground transition-colors hover:text-primary min-[1100px]:text-sm"
          >
            Sign in
          </Link>
          <Button
            variant="ghost"
            size="sm"
            aria-label="menu"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="hidden h-9 w-9 p-0 text-base max-[768px]:inline-flex"
          >
            ☰
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
                      "flex min-h-10 items-center rounded-lg px-3 text-sm font-medium transition-colors",
                      active ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:bg-primary/10 hover:text-primary",
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
                      "flex min-h-10 w-full items-center justify-between rounded-lg px-3 text-left text-sm font-medium transition-colors",
                      groupActive ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:bg-primary/10 hover:text-primary",
                    )}
                  >
                    <span>{g.label}</span>
                    <span className={cn("text-xs transition-transform", isExpanded && "rotate-180")}>▾</span>
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
                              "flex min-h-9 items-center justify-between rounded-md px-2 text-sm transition-colors",
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
            <Link
              to="/login"
              onClick={() => setOpen(false)}
              className="mt-2 block rounded-lg bg-primary px-3 py-2 text-center text-sm font-semibold text-primary-foreground"
            >
              Sign in
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}