# ReconHub Clay Re-theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-theme frontend/ from Cal.com white/monochrome to the Clay.com warm-playful system with every component rebuilt under ui-ux-pro-max guidance.

**Architecture:** Retoken globals.css first (cream, 6-card palette, Plus Jakarta Sans display, 44px targets), then add icons + ClayScene illustration primitives, then rewrite nav/footer chrome, then landing bands, then 5 shared components, then 9 app routes. CSS-only motion via existing Reveal.

**Tech Stack:** Next.js 14 App Router, React 18, vanilla CSS, vitest + Testing Library. No new npm dependencies.

## Global Constraints

- Canvas #fffaf0, primary #0a0a0a, pink #ff4d8b, teal #1a3a3a, lavender #b8a4ed, peach #ffb084, ochre #e8b94a, mint #a4d4c5, coral #ff6b5a, soft #faf5e8, card #f5f0e0, strong #ebe6d6, hairline #e5e5e5, ink #0a0a0a, body #3a3a3a, muted #6a6a6a, on-primary #ffffff.
- Display Plus Jakarta Sans weight 500 ONLY with negative tracking; body Inter 400.
- Buttons/inputs 44px height, 12px radius; content cards 16px; feature cards 24px; pills 9999px; avatars 36px full circle.
- Section rhythm 96px; container max 1280px.
- No new npm dependencies. No hover styling. Never inline hex in components. Never repeat a card color twice in a row. Max 6 brand colors.
- Dark #101010 footer is REMOVED — footer is cream #faf5e8. No dark surfaces except teal featured pricing tier.
- Body copy 4.5:1 contrast; white text on pink/teal only at display sizes with body copy in white chips.
- All lib/api calls and event handlers byte-identical — styling only.
- Motion respects prefers-reduced-motion.

---

### Task 1: Clay tokens + base CSS

**Files:**
- Modify: `frontend/app/globals.css`
- Modify: `frontend/tests/tokens.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: Clay vars + classes `.container .display .display-xl .btn-primary .btn-secondary .btn-on-color .input-control .badge-pill .feature-card-pink .feature-card-teal .feature-card-lavender .feature-card-peach .feature-card-ochre .feature-card-cream .content-card .footer-grid .grid-3 .grid-4 .hero-grid .reveal`.

- [ ] **Step 1: Strengthen the failing test**

Replace `frontend/tests/tokens.test.tsx` with raw-CSS assertions (jsdom ignores stylesheets, so assert on file text):

```tsx
import fs from "fs";
import path from "path";
const css = fs.readFileSync(path.join(__dirname, "../app/globals.css"), "utf8");
test("Clay canvas + primary tokens exist", () => {
  expect(css).toMatch(/--canvas\s*:\s*#fffaf0/i);
  expect(css).toMatch(/--primary\s*:\s*#0a0a0a/);
  expect(css).toMatch(/--brand-pink\s*:\s*#ff4d8b/i);
  expect(css).toMatch(/--brand-teal\s*:\s*#1a3a3a/);
});
test("no dark footer token usage remains", () => {
  expect(css).not.toMatch(/#101010/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/tokens.test.tsx`
Expected: FAIL (old Cal.com values #ffffff/#111111 present, no brand tokens).

- [ ] **Step 3: Write minimal implementation**

Rewrite `frontend/app/globals.css`: Google Fonts import for `Plus+Jakarta+Sans:wght@500;600` + `Inter:wght@400;500;600` (must be first line); all spec vars; body cream bg + Inter; `.display` Plus Jakarta Sans 500 -0.05em ink; `.display-xl` 72px/1.0/-2.5px; container 1280px; buttons 44px/12px (primary #0a0a0a, secondary cream hairline, on-color white/ink); inputs cream 44px/12px + `:focus-visible` 2px ink outline offset 2px; six feature-card classes 24px/32px with correct text colors (pink/teal white headings, rest ink); content-card 16px; badge-pill cream; footer-grid base + 768px 1fr collapse; grid-3/grid-4 + 1024/768 breakpoints (carry over, values unchanged); hero-grid; topnav hooks; reveal rise+scale 400ms + stagger via animation-delay + reduced-motion final state. Delete legacy dark shims referencing #111/#101010 aesthetics (keep class names only where Task 6-7 still need them this cycle: glass-card→cream map, modern-table→light map).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/tokens.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/globals.css frontend/tests/tokens.test.tsx
git commit -m "feat: add Clay tokens and base CSS"
```

### Task 2: SVG icons + ClayScene illustrations

**Files:**
- Create: `frontend/components/icons.tsx`
- Create: `frontend/components/ClayScene.tsx`
- Create: `frontend/tests/clay-scene.test.tsx`

**Interfaces:**
- Consumes: Task 1 palette (use hexes ONLY inside these two files as the palette source; all other components reference classes/vars).
- Produces: named icon exports `IconBox IconTag IconReturn IconAlert IconCoin IconReceipt IconTruck IconRefund IconSpark`; `ClayScene({variant}: {variant: "mountains" | "horizon"})`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/tests/clay-scene.test.tsx
import { render } from "@testing-library/react";
import ClayScene from "../components/ClayScene";
import { IconBox } from "../components/icons";
test("mountains scene renders svg", () => {
  const { container } = render(<ClayScene variant="mountains" />);
  expect(container.querySelector("svg")).toBeTruthy();
});
test("horizon scene renders svg", () => {
  const { container } = render(<ClayScene variant="horizon" />);
  expect(container.querySelector("svg")).toBeTruthy();
});
test("icons render svg paths", () => {
  const { container } = render(<IconBox />);
  expect(container.querySelector("svg path")).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/clay-scene.test.tsx`
Expected: FAIL (files not found).

- [ ] **Step 3: Write minimal implementation**

`icons.tsx`: nine stroke icons, `stroke="currentColor"`, strokeWidth 1.8, fill none, viewBox 0 0 24 24, props `{size?: number}` default 18. Simple geometric paths (box, tag, arrow-uturn, triangle-alert, coin circle, receipt, truck, refund arrow, sparkle). No emoji anywhere.

`ClayScene.tsx`: `"use client"` not needed (pure SVG). `mountains`: viewBox 0 0 560 420, sky transparent, sun circle ochre, three layered ranges (lavender back, peach mid, ochre front) as rounded paths with translucent overlap paths for clay depth, mint hill accents, parcel-mascot group (rounded rect ochre body rx 18, ink dot eyes + smile path, mint tape rect) at front-right. `horizon`: viewBox 0 0 1200 160, two low ranges (strong cream + ochre) + mint dots. `role="img"` + `<title>` per variant for a11y. Palette hexes live ONLY here.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/clay-scene.test.tsx`
Expected: PASS. Then full `npm test`.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/icons.tsx frontend/components/ClayScene.tsx frontend/tests/clay-scene.test.tsx
git commit -m "feat: add SVG icons and Clay illustration scenes"
```

### Task 3: Cream nav + category tabs + cream footer

**Files:**
- Modify: `frontend/components/TopNav.tsx`
- Modify: `frontend/components/NavPillGroup.tsx`
- Modify: `frontend/components/Footer.tsx`
- Modify: `frontend/tests/nav.test.tsx`

**Interfaces:**
- Consumes: Task 1 classes/vars, Task 2 icons (mascot dot stays CSS, no icon needed).
- Produces: same component signatures; cream visuals; footer cream with horizon scene.

- [ ] **Step 1: Extend the failing test**

Add to `frontend/tests/nav.test.tsx`:

```tsx
test("topnav uses cream background", () => {
  const { container } = render(<TopNav />);
  const header = container.querySelector("header") as HTMLElement;
  expect(header.outerHTML + (header.getAttribute("style") ?? "")).toMatch(/#fffaf0|cream|var\(--canvas\)/i);
});
```

Read the existing test file first and keep its three tests intact.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/nav.test.tsx`
Expected: FAIL (header uses #fff).

- [ ] **Step 3: Write minimal implementation**

TopNav: header cream var(--canvas), hairline bottom border, ink wordmark + ochre rounded mascot dot (CSS circle with ink R), center links Product/Solutions/Resources/Pricing/Customers, right Sign in text-link + Try free btn-primary 44px, hamburger sheet cream. NavPillGroup: wrapper transparent, segments transparent muted, active cream-card #f5f0e0 ink 8x16 pill (keep `pill-active` class + items/active props). Footer: rewrite to cream #faf5e8, ink headings, body links, 4 cols, 80px padding, `ClayScene variant="horizon"` bottom, remove ALL #101010/dark styles.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/nav.test.tsx`
Expected: PASS. Then full `npm test`.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/TopNav.tsx frontend/components/NavPillGroup.tsx frontend/components/Footer.tsx frontend/tests/nav.test.tsx
git commit -m "feat: cream nav, category tabs and footer"
```

### Task 4: Landing rebuild in Clay

**Files:**
- Modify: `frontend/app/page.tsx`
- Modify: `frontend/tests/landing.test.tsx`

**Interfaces:**
- Consumes: Tasks 1-3 (tokens, ClayScene, Footer, Reveal).
- Produces: `/` with Clay bands in card-cycle order pink→teal→lavender→peach→ochre→cream.

- [ ] **Step 1: Strengthen the failing test**

Rewrite `frontend/tests/landing.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import Home from "../app/page";
test("landing renders hero h1", () => {
  render(<Home />);
  expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
});
test("landing cycles saturated cards without dark footer", () => {
  const { container } = render(<Home />);
  expect(container.querySelector(".feature-card-pink")).toBeTruthy();
  expect(container.querySelector(".feature-card-teal")).toBeTruthy();
  expect(container.innerHTML).not.toMatch(/#101010/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/landing.test.tsx`
Expected: FAIL (old white/Cal.com bands, no feature-card-pink).

- [ ] **Step 3: Write minimal implementation**

Rewrite bands in `frontend/app/page.tsx` (keep file/component shape, Reveal usage, delay props): hero 7/5 cream, display-xl h1, lead, primary+secondary 44px row; right hero-illustration-card soft bg 24px with `<ClayScene variant="mountains" />`; trust strip; features 3-up (pink Sync / teal Scan / lavender Reconcile) with white-chip product fragments (order row, scan input+Confirm button, exceptions line); product band cream card + display-lg side copy; how-it-works 3-up (peach / ochre / cream); testimonials 3-up cream cards 36px pastel avatars; pricing (white tiers + featured teal tier, feature lists in white chips); cta-band-illustrated soft 24px 80px + mascot mark + primary CTA; `<Footer />`. White headings on pink/teal at display sizes only; ALL body copy ink (in chips on saturated cards). 96px section padding, container 1280.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/landing.test.tsx`
Expected: PASS. Then full `npm test`.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/page.tsx frontend/tests/landing.test.tsx
git commit -m "feat: rebuild landing in Clay system"
```

### Task 5: Shared components in Clay

**Files:**
- Modify: `frontend/components/MetricCard.tsx`
- Modify: `frontend/components/OrderTable.tsx`
- Modify: `frontend/components/SeverityBadge.tsx`
- Modify: `frontend/components/Timeline.tsx`
- Modify: `frontend/components/ScanBanner.tsx`
- Modify: `frontend/tests/timeline.test.tsx`

**Interfaces:**
- Consumes: Tasks 1-2. Props preserved exactly (MetricCard keeps optional `points`).
- Produces: same props, Clay styling, zero emoji.

- [ ] **Step 1: Write the failing test**

Add positive Clay assertion to `frontend/tests/timeline.test.tsx` (keep existing dark-absence test):

```tsx
test("timeline uses cream fragment cards", () => {
  const { container } = render(<Timeline items={[{at:"now",kind:"DISPATCHED",label:"Dispatched",detail:"ok"}]} />);
  expect(container.innerHTML).toMatch(/f5f0e0|ffaf|content-card|#fffaf0/i);
});
```

Read the test file first for its current imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/timeline.test.tsx`
Expected: FAIL (white cards, no cream).

- [ ] **Step 3: Write minimal implementation**

MetricCard: cream content-card 16px, caption-uppercase label, display-sm ink value, ink SVG sparkline, icon chip pastel fill + Task-2 SVG icon prop (change `icon?: string` emoji to `icon?: React.ReactNode`, update dashboard call sites in Task 6 if needed — preferred: keep `icon` name, accept node). OrderTable: white wrapper hairline 16px, thead styles moved into `.modern-table` CSS (delete inline thead dup), badge-pill + palette dots, ink amounts, secondary Timeline link. SeverityBadge: badge-pill + dot map (CRITICAL coral #ff6b5a, HIGH ochre #e8b94a, MEDIUM violet #8b5cf6, LOW teal #1a3a3a). Timeline: cream rail, palette dots, white fragment cards. ScanBanner: cream card + 4px status border, ink text, roles kept. No emoji anywhere in these files.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS all suites.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/MetricCard.tsx frontend/components/OrderTable.tsx frontend/components/SeverityBadge.tsx frontend/components/Timeline.tsx frontend/components/ScanBanner.tsx frontend/tests/timeline.test.tsx
git commit -m "feat: rebuild shared components in Clay system"
```

### Task 6: App routes in Clay

**Files:**
- Modify all 9: `frontend/app/login/page.tsx`, `frontend/app/dashboard/page.tsx`, `frontend/app/orders/page.tsx`, `frontend/app/orders/[id]/page.tsx`, `frontend/app/scan/dispatch/page.tsx`, `frontend/app/scan/return/page.tsx`, `frontend/app/exceptions/page.tsx`, `frontend/app/settings/tally/page.tsx`, `frontend/app/parcels/[barcode]/page.tsx`
- Modify: `frontend/tests/dashboard.test.tsx`

**Interfaces:**
- Consumes: Tasks 1-5. api/handlers byte-identical.
- Produces: cream canvas, per-route saturated signature band, NavPillGroup actives unchanged.

- [ ] **Step 1: Write the failing test**

Extend `frontend/tests/dashboard.test.tsx` (read first, keep existing tests):

```tsx
test("dashboard uses cream canvas without dark surfaces", () => {
  const { container } = render(<DashboardPage />);
  expect(container.innerHTML).not.toMatch(/#101010|#0f172a|glass-card/);
});
```

Note: DashboardPage fetches via mocked api (follow existing mock pattern in that file).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/dashboard.test.tsx`
Expected: FAIL (white Cal.com surfaces; glass-card gone already so craft assertion against `#ffffff` page bg or white-only KPI cards — read file, choose an assertion that fails pre-change, e.g. absence of `feature-card`/`peach` signature band).

- [ ] **Step 3: Write minimal implementation**

Per route, styling only: cream page bg, container, NavPillGroup same active, signature saturated band/card 24px (dashboard peach band + KPI cream MetricCards with SVG icons; dispatch ochre scanner card; return lavender; exceptions pink-tint state cards; tally teal accents; orders cream + ochre sync band; order-detail/parcels cream fragment cards; login white 440px card on cream + mascot mark + black 44px CTA). Tables white for contrast. Modal scrim → rgba(250,245,232,.85). Replace ALL emoji icons with Task-2 SVG icons. Update MetricCard `icon` call sites to SVG nodes. Keep every api() call and handler identical.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/login/page.tsx frontend/app/dashboard/page.tsx frontend/app/orders/page.tsx "frontend/app/orders/[id]/page.tsx" frontend/app/scan/dispatch/page.tsx frontend/app/scan/return/page.tsx frontend/app/exceptions/page.tsx frontend/app/settings/tally/page.tsx "frontend/app/parcels/[barcode]/page.tsx" frontend/tests/dashboard.test.tsx
git commit -m "feat: re-theme app routes to Clay system"
```

### Task 7: Verification + responsive + contrast pass

**Files:**
- Modify: `frontend/app/globals.css` (breakpoints/polish only)

**Interfaces:**
- Consumes: all tasks. Produces: 375/768/1024/1440 verified, hero 72→36px mobile.

- [ ] **Step 1: Add responsive + polish CSS**

Ensure in breakpoints: `.display-xl` 72px desktop → 36px ≤768px; hero-grid 7/5→1fr; grid-3/grid-4 3→2→1; footer-grid →1fr (already); pricing tiers →1fr ≤768px (add `.pricing-grid` if page uses inline grid — prefer adding class in page only if missing, else CSS hook). Confirm `.topnav-links`/`.topnav-menu-btn` toggle intact.

- [ ] **Step 2: Run full verification**

Run: `npm test`
Expected: PASS all suites.
Run: `npm run build`
Expected: SUCCESS, 11 pages, no type errors.

- [ ] **Step 3: Manual + contrast check**

Grep: no `#101010` outside teal-featured pricing; no `📦|🏷️|🔄|⚠️|💰|🧾|🚚|💸|✨|⚡|❌|✅|🚪` emoji in components/app; no inline hex outside ClayScene/icons. Class reasoning for 375/768/1024/1440 (hero stack, pricing collapse, footer collapse, pill scroll).

- [ ] **Step 4: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat: responsive breakpoints and contrast polish"
```
