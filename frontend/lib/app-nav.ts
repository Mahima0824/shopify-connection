export type NavChild = { label: string; href: string };
export type NavEntry = { label: string; href?: string; children?: NavChild[] };
export const APP_NAV_GROUPS: NavEntry[] = [
  { label: "Dashboard", href: "/dashboard" },
  {
    label: "Orders",
    children: [
      { label: "Orders", href: "/orders" },
      { label: "Parcels", href: "/parcels" },
      { label: "Shipments", href: "/shipments" },
      { label: "Tracking Center", href: "/tracking" },
      { label: "Outstanding", href: "/shipments/outstanding" },
    ],
  },
  {
    label: "Scan",
    children: [
      { label: "Hub", href: "/scan" },
      { label: "Dispatch", href: "/scan/dispatch" },
      { label: "Returns", href: "/scan/return" },
      { label: "RTO", href: "/scan/rto" },
    ],
  },
  { label: "Tracking", href: "/tracking" },
  { label: "Exceptions", href: "/exceptions" },
  {
    label: "Finance",
    children: [
      { label: "Statements", href: "/statements" },
      { label: "Ledger", href: "/finance/ledger" },
      { label: "Close", href: "/finance/close" },
      { label: "Reports", href: "/reports/monthly" },
      { label: "Tally", href: "/settings/tally" },
    ],
  },
];
export const APP_NAV_FLAT: NavChild[] = APP_NAV_GROUPS.flatMap((g) =>
  g.href ? [{ label: g.label, href: g.href }] : (g.children ?? []),
);
// Legacy compat (migrated in Task 6 — TopNav owns nav now).
export const APP_NAV_ITEMS = APP_NAV_FLAT;
