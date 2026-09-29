# ReconHub Enterprise-Clean Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Clay playful system with a neutral enterprise-clean system on all 25 routes, fixing the nav crowding, blank voids, and dead empty states.

**Architecture:** Retoken globals.css first (neutral palette, Inter-only, tnum, subtle motion), then grouped nav (app-nav groups + TopNav dropdowns + mobile accordion), then Reveal safety fallback, then shared components, then landing, then all app routes with compact headers + actionable empty states, then verification incl. Playwright re-screenshots.

**Tech Stack:** Next.js 14 App Router, React 18, vanilla CSS, vitest + Testing Library, playwright-cli for visual verification. No new npm dependencies.

## Global Constraints

- Canvas #ffffff, surface #f8fafc, card #ffffff, ink #0f172a, body #334155, muted #64748b, hairline #e2e8f0, accent #0f7665, accent-strong #115e59, on-accent #ffffff, success #15803d, warning #b45309, error #b91c1c, success-bg #dcfce7, warning-bg #fef3c7, error-bg #fee2e2, info-bg #e0f2fe, neutral-bg #f1f5f9.
- Inter only, headings 600/-0.02em, body 15-16px/1.5, tabular-nums via .tnum on money/quantities.
- Buttons/inputs 44px min-height, 8px radius; cards 12px; pills 9999px; avatars 36px.
- No new npm dependencies. No decorative saturated fills. Color means status or primary action only. Never inline hex. All api/handlers byte-identical. Motion respects prefers-reduced-motion.

---

### Task 1: Enterprise tokens + base CSS

**Files:**
- Modify: `frontend/app/globals.css`
- Modify: `frontend/tests/tokens.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: neutral vars + `.tnum`, 8px buttons, accent focus, subtle reveal, retired feature-card classes.

- [ ] **Step 1: Rewrite the failing test**

```tsx
// frontend/tests/tokens.test.tsx
import fs from "fs";
import path from "path";
const css = fs.readFileSync(path.join(__dirname, "../app/globals.css"), "utf8");
test("enterprise canvas + ink + accent tokens exist", () => {
  expect(css).toMatch(/--canvas\s*:\s*#ffffff/i);
  expect(css).toMatch(/--ink\s*:\s*#0f172a/i);
  expect(css).toMatch(/--accent\s*:\s*#0f7665/i);
});
test("no Clay palette or dark footer remnants", () => {
  expect(css).not.toMatch(/#fffaf0|#ff4d8b|#1a3a3a|#101010/i);
});
test("tabular numerals utility exists", () => {
  expect(css).toMatch(/\.tnum/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/tokens.test.tsx`
Expected: FAIL (Clay values present).

- [ ] **Step 3: Write minimal implementation**

Rewrite token values in `frontend/app/globals.css` to §4 spec (keep file structure, class names, breakpoints, print block). Changes: `:root` vars → enterprise set; `body` stays Inter; `.display`/`.display-xl` → Inter 700/-0.02em (hero 56px? keep 72px class but landing uses 56 inline — set `.display-xl` 56px/1.05); `.btn-primary` accent bg + on-accent text, 8px radius; `.btn-secondary` white hairline 8px; add `.tnum{font-variant-numeric:tabular-nums;}`; focus outlines → accent; badges → tint system (success/warning/error/info/neutral with ink/700 text); `.modern-table` keep, thead sticky via `.modern-table thead th{position:sticky;top:64px;}` (below sticky nav); feature-card-* classes → neutral white card 12px (remap, do NOT leave Clay fills); `.reveal.is-visible` animation → `fadeRise 250ms ease-out` (rename keyframes, update riseScale refs); add `@keyframes fadeRise{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}}`; remove old riseScale. Keep `.cols-2/.cols-3`, grid hooks, topnav hooks, footer-grid, responsive blocks, dvh/fullscreen-center, underline reset.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/tokens.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/globals.css frontend/tests/tokens.test.tsx
git commit -m "feat: enterprise tokens and base CSS"
```

### Task 2: Grouped navigation

**Files:**
- Modify: `frontend/lib/app-nav.ts`
- Modify: `frontend/components/TopNav.tsx`
- Modify: `frontend/tests/nav.test.tsx`

**Interfaces:**
- Consumes: Task 1 tokens/classes.
- Produces: `APP_NAV_GROUPS` + `APP_NAV_FLAT` (compat), TopNav with dropdowns + accordion sheet + active trail.

- [ ] **Step 1: Write the failing test**

```tsx
// add to frontend/tests/nav.test.tsx (read file first, keep existing tests)
test("topnav groups routes with active trail", () => {
  const { container } = render(<TopNav />);
  const nav = container.querySelector('nav[aria-label="Primary"]') as HTMLElement;
  for (const label of ["Dashboard", "Orders", "Scan", "Exceptions", "Finance", "Import"]) {
    expect(nav.textContent).toMatch(label);
  }
  expect(container.querySelector('[aria-current="page"]')).toBeTruthy();
});
```

Requires `vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }))` (already in file — read first and reuse).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/nav.test.tsx`
Expected: FAIL (11 flat links, no groups).

- [ ] **Step 3: Write minimal implementation**

`lib/app-nav.ts`:

```ts
export type NavChild = { label: string; href: string };
export type NavEntry = { label: string; href?: string; children?: NavChild[] };
export const APP_NAV_GROUPS: NavEntry[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Orders", children: [
    { label: "Orders", href: "/orders" },
    { label: "Parcels", href: "/parcels" },
    { label: "Shipments", href: "/shipments" },
    { label: "Outstanding", href: "/shipments/outstanding" },
  ]},
  { label: " Scan", children: [
    { label: "Hub", href: "/scan" },
    { label: "Dispatch", href: "/scan/dispatch" },
    { label: "Returns", href: "/scan/return" },
    { label: "RTO", href: "/scan/rto" },
  ]},
  { label: "Exceptions", href: "/exceptions" },
  { label: "Finance", children: [
    { label: "Statements", href: "/statements" },
    { label: "Reports", href: "/reports/monthly" },
    { label: "Tally", href: "/settings/tally" },
  ]},
  { label: "Import", href: "/import" },
];
```

Plus `APP_NAV_FLAT`: flattened array of every child href pair, exported for any page still importing flat items (grep importers in Task 6 and migrate them to remove the import; keep the export to avoid breakage):

```ts
export const APP_NAV_FLAT: NavChild[] = APP_NAV_GROUPS.flatMap((g) =>
  g.href ? [{ label: g.label, href: g.href }] : (g.children ?? [])
);
```

`TopNav.tsx`: keep header shell (64px, sticky, hairline, container, wordmark, Sign in, hamburger). Center: render groups — plain link if `href`, else dropdown wrapper (`<div>` with button + absolutely-positioned white hairline 12px menu div, opens on hover via CSS group + onClick toggle for touch, closes on link click/Escape). Active trail: `isActive` exact-or-subpath; parent group active if any child active (pill highlight on parent). Mobile sheet: accordion groups (tap expands children) + Sign in. Keep `aria-current="page"` on the exact active link, `aria-expanded` on dropdown buttons. No new deps. CSS hover dropdown: use a `.nav-drop` class + `.nav-drop-menu{display:none}` / `.nav-drop.open .nav-drop-menu, .nav-drop:hover .nav-drop-menu{display:block}` added to globals.css in this task (append small block).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/nav.test.tsx`
Expected: PASS. Then full `npm test`.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/app-nav.ts frontend/components/TopNav.tsx frontend/tests/nav.test.tsx frontend/app/globals.css
git commit -m "feat: grouped navigation with dropdowns"
```

### Task 3: Reveal safety + subtle motion

**Files:**
- Modify: `frontend/components/Reveal.tsx`
- Modify: `frontend/tests/nav.test.tsx` (Reveal test lives there — read first)

**Interfaces:**
- Consumes: Task 1 fadeRise CSS.
- Produces: same `Reveal({children, delay})` signature + 1200ms force-visible fallback.

- [ ] **Step 1: Write the failing test**

```tsx
test("reveal force-shows content even if observer never fires", async () => {
  const { container } = render(<Reveal delay={120}>hello</Reveal>);
  await new Promise((r) => setTimeout(r, 1300));
  expect(container.querySelector(".reveal")?.classList.contains("is-visible")).toBe(true);
});
```

Note: jsdom has no IntersectionObserver → existing no-observer path adds is-visible immediately; this test also passes via that path. To exercise the fallback with a real observer, mock IntersectionObserver with a never-firing observe(), then advance. Implement: in test file, `vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} })`, render, wait 1300ms (use real timers), assert is-visible, then `vi.unstubAllGlobals()`. Keep existing Reveal test intact.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/nav.test.tsx`
Expected: FAIL (no fallback timer; class never added with stubbed observer).

- [ ] **Step 3: Write minimal implementation**

In `Reveal.tsx` effect, after setting up observer, add:

```tsx
const fallback = setTimeout(() => {
  el.classList.add("is-visible");
  io.disconnect();
}, 1200);
```

Clear in cleanup (`clearTimeout(fallback)`). Also clear it when observer fires first (inside the isIntersecting branch). Keep delay prop, threshold, disconnect, reduced-motion (CSS handles). Return cleanup disconnects + clears timeout.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/nav.test.tsx`
Expected: PASS. Then full `npm test`.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/Reveal.tsx frontend/tests/nav.test.tsx
git commit -m "fix: reveal force-visible fallback"
```

### Task 4: Shared components enterprise

**Files:**
- Modify: `frontend/components/MetricCard.tsx`
- Modify: `frontend/components/OrderTable.tsx`
- Modify: `frontend/components/SeverityBadge.tsx`
- Modify: `frontend/components/Timeline.tsx`
- Modify: `frontend/components/ScanBanner.tsx`
- Create: `frontend/components/EmptyState.tsx`
- Modify: `frontend/tests/timeline.test.tsx`

**Interfaces:**
- Consumes: Tasks 1-2. Props preserved (MetricCard `icon?: React.ReactNode` stays).
- Produces: neutral components + `EmptyState({icon, title, body, primary, secondary})`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/tests/timeline.test.tsx` (read first, keep existing):

```tsx
test("empty state renders actions", () => {
  const { container } = render(
    <EmptyState
      title="Nothing here"
      body="Sync to populate."
      primary={{ label: "Sync now", href: "/orders" }}
    />
  );
  expect(container.textContent).toMatch(/Nothing here/);
  expect(container.querySelector('a[href="/orders"]')?.textContent).toMatch(/Sync now/);
});
```

Import EmptyState from `../components/EmptyState` (fails: file absent).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/timeline.test.tsx`
Expected: FAIL (EmptyState not found).

- [ ] **Step 3: Write minimal implementation**

`EmptyState.tsx`: white card 12px hairline, centered, 48px neutral tile with SVG icon node prop (`icon?: React.ReactNode`), h3 18px/600 ink title, muted body, row of actions: `primary {label, href}` → btn-primary Link, `secondary? {label, href}` → btn-secondary Link. Props: `{icon?: React.ReactNode; title: string; body: string; primary: {label:string;href:string}; secondary?: {label:string;href:string}}`.

Restyle (styling only, no prop/logic changes): MetricCard → white card, uppercase label, 28px semibold `.tnum` value, delta line support via existing subtitle/trend (keep props), sparkline accent stroke; OrderTable → keep structure, sticky thead (CSS), row hover (add `.modern-table tbody tr:hover{background:var(--surface);}` to globals.css here), `.tnum` on amount cells, status pills unchanged classes (now tinted); SeverityBadge → CRITICAL error / HIGH warning / MEDIUM info / LOW neutral badge classes; Timeline → neutral rail (hairline), status dots keep palette-var dots? No — enterprise: dots use success/warning/error/info vars (map DISPATCHED success, RETURN warning, REFUND error, else info); ScanBanner → white card + status border (success/warning/error vars), ink text, roles kept. Zero emoji (verify none exist). Replace any Clay var refs (card/peach/ochre/soft) with enterprise vars.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS all.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/MetricCard.tsx frontend/components/OrderTable.tsx frontend/components/SeverityBadge.tsx frontend/components/Timeline.tsx frontend/components/ScanBanner.tsx frontend/components/EmptyState.tsx frontend/tests/timeline.test.tsx frontend/app/globals.css
git commit -m "feat: enterprise shared components and empty state"
```

### Task 5: Enterprise landing

**Files:**
- Modify: `frontend/app/page.tsx`
- Modify: `frontend/tests/landing.test.tsx`
- Delete if orphaned: `frontend/components/ClayScene.tsx` + `frontend/tests/clay-scene.test.tsx` (only if zero imports remain — grep first; Footer horizon usage must be replaced in this task if so)

**Interfaces:**
- Consumes: Tasks 1-4 (tokens, Footer — restyle in this task, Reveal, EmptyState not needed).
- Produces: `/` enterprise landing, all 5 nav anchors resolving.

- [ ] **Step 1: Rewrite the failing test**

```tsx
// frontend/tests/landing.test.tsx
import { render, screen } from "@testing-library/react";
import Home from "../app/page";
test("landing renders enterprise hero", () => {
  render(<Home />);
  expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
});
test("landing has no Clay fills and anchors resolve", () => {
  const { container } = render(<Home />);
  expect(container.innerHTML).not.toMatch(/feature-card-(pink|teal|lavender|peach|ochre)|#fffaf0|#ff4d8b/i);
  for (const id of ["product", "solutions", "resources", "pricing", "customers"]) {
    expect(container.querySelector(`#${id}`)).toBeTruthy();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/landing.test.tsx`
Expected: FAIL (Clay classes present).

- [ ] **Step 3: Write minimal implementation**

Rewrite `frontend/app/page.tsx` bands (keep component shape, Reveal + delays, Footer usage): hero 2-col (7/5): left eyebrow label + 56px Inter 700 h1 + subcopy + accent btn-primary (sticky? no — normal) + secondary; right product-mockup white card: KPI mini-row (3 stats, .tnum) + 4-row mini ledger table + sync-status success chip. Metric strip: 4 stats with .tnum (orders synced / parcels scanned / exceptions resolved / export accuracy). Features 3-up white hairline cards with Task-2 SVG icons (Sync/Scan/Reconcile copy kept). Workflow band: 3 steps with numbered markers. Testimonials 3-up white, 36px neutral initials avatars (no pastels). Pricing 3-up white + featured accent-outline (2px accent border + "Most popular" chip, NOT filled). CTA band neutral soft + primary CTA. Footer: restyle to light (ink headings, body links, no horizon scene; replace ClayScene import with nothing; keep 4 cols + bottom bar). Keep section ids product/solutions/resources/pricing/customers mapped to sensible bands. 96px sections (64px ≤768 existing). No emoji, no hex, no Clay classes.

If `ClayScene` has zero remaining imports after Footer rewrite (grep `ClayScene` across frontend/), delete `frontend/components/ClayScene.tsx` + `frontend/tests/clay-scene.test.tsx` via `Remove-Item`, and remove its nav? No nav refs. Icons.tsx stays (used by app).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/landing.test.tsx`
Expected: PASS. Then full `npm test`.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/page.tsx frontend/tests/landing.test.tsx frontend/components/Footer.tsx
git commit -m "feat: enterprise landing"
```

### Task 6: App routes enterprise (all 24)

**Files:** every `frontend/app/**/page.tsx` except `page.tsx` (landing, Task 5) — 24 files:
dashboard, login, import, orders, orders/[id], parcels, parcels/[barcode], parcels/labels, parcels/test-sheet, scan, scan/dispatch, scan/return, scan/rto, shipments, shipments/[id], shipments/outstanding, statements, statements/[id], reports/monthly, exceptions, settings/tally, settings/costs, settings/carriers, settings/sla.
Plus `frontend/tests/dashboard.test.tsx`.

**Interfaces:**
- Consumes: Tasks 1-5. api/handlers byte-identical.
- Produces: compact headers + EmptyStates + neutral surfaces everywhere.

- [ ] **Step 1: Extend the failing test**

Read `frontend/tests/dashboard.test.tsx` first, keep tests, add:

```tsx
test("dashboard empty state offers sign-in and sync actions", () => {
  // ...follow existing mock pattern, render logged-out state...
  expect(screen.getByText(/Sign in/i)).toBeTruthy();
});
```

Concretely: reuse the file's existing api-mock + logged-out render; assert an anchor to `/login` and one triggering sync exist. If the current file structure differs, adapt: the assertion must FAIL pre-change (peach band + "Dashboard Unavailable" card, no actions).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/dashboard.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Per route, styling only: replace signature saturated band with compact header block (`<div>` container: h1 28px/700 + muted description + right action row). Replace dead empty cards with `<EmptyState>` (icon SVG, title, body, primary/secondary actions: Sign in → /login, Sync → existing sync handler route, Scan → /scan/dispatch). Tables/forms/cards → white/neutral per Task 4 components (most already are; swap remaining Clay var refs: `var(--card)`→white? No — card IS #ffffff now; check each file for `feature-card-*`, `var(--soft)` misuse, pastel fills, emoji). MetricCard icons already SVG nodes — keep. Migrate any `APP_NAV_ITEMS`/`APP_NAV_FLAT` imports affected by Task 2 (grep; TopNav owns nav now — pages must not render pills; delete leftovers). Keep every api() call and handler identical — verify with `git diff` showing only JSX/style/test lines.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/dashboard frontend/app/login frontend/app/import frontend/app/orders frontend/app/parcels frontend/app/scan frontend/app/shipments frontend/app/statements frontend/app/reports frontend/app/exceptions/frontend/app/settings frontend/tests/dashboard.test.tsx
git commit -m "feat: enterprise app routes with actionable empty states"
```

(Note: `frontend/app/exceptions/frontend/app/settings` needs a space — write paths carefully: `frontend/app/exceptions frontend/app/settings`.)

### Task 7: Verification + Playwright evidence

**Files:**
- Modify: `frontend/app/globals.css` only if gaps found (breakpoints/polish).

**Interfaces:**
- Consumes: all tasks. Produces: screenshot-verified responsive + contrast.

- [ ] **Step 1: Re-screenshot key routes**

With dev server running (`npm run dev` in frontend/), use playwright-cli:
`open http://localhost:<port>/dashboard`, `screenshot --full-page`; repeat for `/`, `/orders`, `/scan/dispatch`; then `open --mobile` + landing screenshot. Compare against spec §2 evidence: nav fits one row (desktop), no blank voids, empty states actionable, no horizontal scroll at 390px.

- [ ] **Step 2: Fix gaps in CSS only**

Any overflow/crowding found → globals.css media queries or utility classes only; no component rework. Examples: `.modern-table{min-width:720px;}` inside scroll wrapper (already wrapped), dropdown menu max-height scroll.

- [ ] **Step 3: Run full verification**

Run: `npm test`
Expected: PASS all.
Run: `npm run build`
Expected: SUCCESS, 24+ pages, no type errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat: verification polish from screenshots"
```
