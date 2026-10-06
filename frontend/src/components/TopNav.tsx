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

/* Nav pills keep a 44px min-height for the handheld scanners; the active state
   is a surface fill rather than a colour change so it reads at a glance. */
const PILL =
  "inline-flex min-h-11 items-center rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors";

export default function TopNav() {
  const [open, setOpen] = useState(false);
  const [openDrop, setOpenDrop] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { pathname } = useLocation();

  const closeDrop = () => setOpenDrop(null);

  return (
    <header className="sticky top-0 z-50 h-16 border-b border-border bg-background">
      <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center justify-between px-6 max-[480px]:px-4">
        <Link to="/" className="text-lg font-semibold text-foreground">
          ReconHub
        </Link>
        <nav
          aria-label="Primary"
          className="hidden max-w-full gap-1 overflow-x-auto text-sm font-medium min-[769px]:flex"
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
                    active ? "bg-card text-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {g.label}
                </Link>
              );
            }
            const dropOpen = openDrop === g.label;
            const primaryHref = g.children?.[0]?.href ?? "/";
            return (
              <div key={g.label} className="group relative inline-flex items-center">
                <Link
                  to={primaryHref}
                  aria-current={isExact(pathname, primaryHref) ? "page" : undefined}
                  onClick={closeDrop}
                  className={cn(
                    PILL,
                    "rounded-r-none",
                    active ? "bg-card text-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {g.label}
                </Link>
                <button
                  type="button"
                  aria-expanded={dropOpen}
                  aria-haspopup="true"
                  aria-label={`${g.label} submenu`}
                  onClick={() => setOpenDrop(dropOpen ? null : g.label)}
                  className={cn(
                    PILL,
                    "gap-0.5 rounded-l-none pl-1 pr-2.5 text-xs",
                    active ? "bg-card text-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  ▾
                </button>
                <div className="invisible absolute top-full left-0 z-60 min-w-[200px] rounded-xl border border-border bg-card p-1 opacity-0 transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                  {(g.children ?? []).map((c) => {
                    const childActive = isActive(pathname, c.href);
                    return (
                      <Link
                        key={c.href}
                        to={c.href}
                        aria-current={isExact(pathname, c.href) ? "page" : undefined}
                        onClick={closeDrop}
                        className={cn(
                          "flex min-h-11 items-center rounded-lg px-4 py-2.5 text-sm whitespace-nowrap",
                          childActive
                            ? "bg-muted text-foreground"
                            : "text-body hover:bg-muted",
                        )}
                      >
                        {c.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="flex items-center gap-3">
          <Link to="/login" className="text-sm font-medium text-foreground">
            Sign in
          </Link>
          <Button
            variant="ghost"
            aria-label="menu"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="hidden max-[768px]:inline-flex"
          >
            ☰
          </Button>
        </div>
      </div>
      {open && (
        <nav aria-label="Mobile" className="border-b border-border bg-background p-4">
          {APP_NAV_GROUPS.map((g) => {
            if (g.href) {
              const active = isActive(pathname, g.href);
              return (
                <Link
                  key={g.label}
                  to={g.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex min-h-11 items-center rounded-full px-4 py-2 text-sm",
                    active ? "bg-card text-foreground" : "text-body",
                  )}
                >
                  {g.label}
                </Link>
              );
            }
            const isExpanded = expanded === g.label;
            const groupActive = isGroupActive(pathname, g.href, g.children);
            return (
              <div key={g.label}>
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={() => setExpanded(isExpanded ? null : g.label)}
                  className={cn(
                    "flex min-h-11 w-full items-center rounded-full px-4 py-2 text-left text-sm font-medium",
                    groupActive ? "bg-card text-foreground" : "text-body",
                  )}
                >
                  {g.label}
                </button>
                {isExpanded &&
                  (g.children ?? []).map((c) => {
                    const childActive = isActive(pathname, c.href);
                    return (
                      <Link
                        key={c.href}
                        to={c.href}
                        onClick={() => setOpen(false)}
                        className={cn(
                          "flex min-h-11 items-center rounded-full py-2 pr-4 pl-8 text-sm",
                          childActive ? "bg-card text-foreground" : "text-body",
                        )}
                      >
                        {c.label}
                      </Link>
                    );
                  })}
              </div>
            );
          })}
          <Link
            to="/login"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm text-foreground"
          >
            Sign in
          </Link>
        </nav>
      )}
    </header>
  );
}