import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
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

export default function TopNav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openDrop, setOpenDrop] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { pathname } = useLocation();

  const closeDrop = () => setOpenDrop(null);

  const activePillClass = "px-3.5 py-1.5 rounded-full text-sm font-semibold bg-white text-slate-900 shadow-xs transition";
  const inactivePillClass = "px-3.5 py-1.5 rounded-full text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition";

  return (
    <header className="sticky top-0 z-50 bg-slate-50/90 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Brand Logo */}
        <Link to="/" className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-emerald-700 text-white flex items-center justify-center text-sm font-black">
            R
          </span>
          ReconHub
        </Link>

        {/* Primary Desktop Nav */}
        <nav className="hidden lg:flex items-center gap-1" aria-label="Primary">
          {APP_NAV_GROUPS.map((g) => {
            const active = isGroupActive(pathname, g.href, g.children);
            if (g.href) {
              return (
                <Link
                  key={g.label}
                  to={g.href}
                  aria-current={active ? "page" : undefined}
                  className={active ? activePillClass : inactivePillClass}
                >
                  {g.label}
                </Link>
              );
            }
            const dropOpen = openDrop === g.label;
            const primaryHref = g.children?.[0]?.href ?? "/";
            return (
              <div
                key={g.label}
                className="relative inline-flex items-center"
                onKeyDown={(e) => {
                  if (e.key === "Escape") closeDrop();
                }}
              >
                <Link
                  to={primaryHref}
                  aria-current={isExact(pathname, primaryHref) ? "page" : undefined}
                  onClick={closeDrop}
                  className={`rounded-l-full pr-2 ${active ? activePillClass : inactivePillClass}`}
                >
                  {g.label}
                </Link>
                <button
                  type="button"
                  aria-expanded={dropOpen}
                  aria-haspopup="true"
                  aria-label={`${g.label} submenu`}
                  onClick={() => setOpenDrop(dropOpen ? null : g.label)}
                  className={`rounded-r-full pl-1 pr-2.5 text-xs font-semibold cursor-pointer ${
                    active ? activePillClass : inactivePillClass
                  }`}
                >
                  ▾
                </button>
                {dropOpen && (
                  <div className="absolute top-full left-0 mt-1 min-w-[200px] bg-white border border-slate-200 rounded-xl p-1.5 shadow-lg z-50 flex flex-col gap-0.5">
                    {(g.children ?? []).map((c) => {
                      const childActive = isActive(pathname, c.href);
                      return (
                        <Link
                          key={c.href}
                          to={c.href}
                          aria-current={isExact(pathname, c.href) ? "page" : undefined}
                          onClick={closeDrop}
                          className={`px-3 py-2 rounded-lg text-xs font-medium transition ${
                            childActive ? "bg-slate-100 text-slate-900 font-semibold" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                          }`}
                        >
                          {c.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          <Link
            to="/login"
            className="text-sm font-medium text-slate-700 hover:text-slate-900 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition"
          >
            Sign in
          </Link>

          {/* Mobile Hamburger Button */}
          <button
            className="lg:hidden text-slate-700 hover:text-slate-900 p-2 rounded-lg hover:bg-slate-100 transition text-lg"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="menu"
            aria-expanded={mobileOpen}
          >
            ☰
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <nav className="lg:hidden px-6 py-4 bg-white border-b border-slate-200 flex flex-col gap-2" aria-label="Mobile">
          {APP_NAV_GROUPS.map((g) => {
            if (g.href) {
              const active = isActive(pathname, g.href);
              return (
                <Link
                  key={g.label}
                  to={g.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setMobileOpen(false)}
                  className={`block px-4 py-2.5 rounded-xl text-sm font-medium ${
                    active ? "bg-slate-100 text-slate-900 font-semibold" : "text-slate-600 hover:bg-slate-50"
                  }`}
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
                  className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium flex items-center justify-between ${
                    groupActive ? "bg-slate-100 text-slate-900 font-semibold" : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span>{g.label}</span>
                  <span className="text-xs">{isExpanded ? "▲" : "▼"}</span>
                </button>
                {isExpanded && (
                  <div className="pl-4 flex flex-col gap-1 mt-1">
                    {(g.children ?? []).map((c) => {
                      const childActive = isActive(pathname, c.href);
                      return (
                        <Link
                          key={c.href}
                          to={c.href}
                          aria-current={isExact(pathname, c.href) ? "page" : undefined}
                          onClick={() => setMobileOpen(false)}
                          className={`block px-4 py-2 rounded-lg text-xs font-medium ${
                            childActive ? "bg-slate-100 text-slate-900 font-semibold" : "text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {c.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      )}
    </header>
  );
}
