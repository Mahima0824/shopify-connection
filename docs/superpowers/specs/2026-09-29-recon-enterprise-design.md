# ReconHub Enterprise-Clean Overhaul — Design Spec
Date: 2026-09-29
Status: approved (Approach A)
Skills: brainstorming (process), ui-ux-pro-max (design intelligence), playwright (evidence)

## 1. Goal
Replace the Clay playful system with a neutral enterprise-clean system across
every component, page, and route. Fix evidence-backed defects: 11-link
cramped nav, blank below-fold voids (Reveal-gated content), dead-band page
headers, weak empty states. Keep IA, APIs, and all behavior identical.

## 2. Evidence (playwright screenshots, 2026-09-29, dev :3100)
- Desktop landing: 11-item nav wraps cramped; full-page capture shows huge
  blank void between trust strip and footer (Reveal sections never became
  visible); hero + illustration render correctly.
- Desktop /dashboard (logged out): giant peach band + "Dashboard
  Unavailable" dead card, large empty areas.
- Mobile landing: same voids dominate; hero stacks correctly; hamburger
  present.
- Console: only 401s from missing auth token (expected, not a defect).

## 3. Decisions (user-confirmed)
- Direction: Enterprise clean (Approach A). Top-nav retained (prior
  decisions stand); no sidebar.
- ui-ux-pro-max research applied: Plus Jakarta Sans confirmed for friendly
  SaaS only — retired here in favor of Inter throughout; CTA contrast 4.5:1
  minimum; sticky hero CTA + bottom CTA; reduced-motion static state;
  44px targets retained; SVG icons retained.

## 4. Tokens (`app/globals.css` rewrite of values, same architecture)
- canvas #ffffff; surface #f8fafc; card #ffffff; ink #0f172a;
  body #334155; muted #64748b; hairline #e2e8f0;
  accent (action) #0f7665 deep teal; accent-strong #115e59 (press);
  on-accent #ffffff; success #15803d; warning #b45309; error #b91c1c;
  status tints: success-bg #dcfce7, warning-bg #fef3c7, error-bg #fee2e2,
  info-bg #e0f2fe, neutral-bg #f1f5f9 (ink text on all tints).
- Radii: buttons/inputs 8px; cards 12px; pills 9999px; avatars 36px full.
- Buttons 44px min-height; primary = accent bg; secondary = white hairline.
- Focus: 2px accent outline offset 2px on all interactives.
- No decorative saturated fills anywhere. Color means status or primary
  action only. Retire all six feature-card-* classes (delete or remap to
  neutral card; no orphan class references in tests).

## 5. Typography (Inter only)
- Display face (Plus Jakarta Sans) retired; keep font import only if a
  component still references it, else remove.
- h1 32px/700/-0.02em (app), landing hero 56px/700/-0.02em → 36px ≤768px;
  h2 22-24px/600; section labels 12px/600/uppercase/0.08em muted.
- Body 15-16px/1.5; tabular-nums (`font-variant-numeric: tabular-nums`)
  on every monetary/quantity figure via `.tnum` utility.
- Links: accent color, no underline except on hover/focus (enterprise
  convention; global reset keeps none by default, underline on hover).

## 6. Navigation (grouped, 6 items)
- `TopNav` center: Dashboard, Orders▾ (Orders, Parcels, Shipments,
  Outstanding), Scan▾ (Hub, Dispatch, Returns, RTO), Exceptions,
  Finance▾ (Statements, Reports, Tally), Import. CSS+hover/focus dropdowns
  on desktop (click also toggles for touch laptops); accordion groups in
  the mobile sheet. Active trail: current section pill-highlighted;
  parent group highlighted when a child route is active
  (pathname startsWith matching, parcels→Orders).
- `lib/app-nav.ts` becomes grouped structure:
  `{ label, href } | { label, children: [{label, href}] }`.
  TopNav consumes groups; no other component imports flat items after
  refactor (update all importers or keep a flat export for compat —
  decide in plan, no orphans).
- Right side unchanged: Sign in (+ wordmark links `/`).

## 7. Reveal safety (the void fix)
- `Reveal.tsx`: add 1200ms fallback timer forcing `is-visible` even if
  IntersectionObserver never fires; keep once-only disconnect; keep
  `animation-delay` stagger prop; reduced-motion path unchanged.
- CSS: retune `riseScale` to subtle fade-rise 250ms (no scale pop).

## 8. Page headers + empty states
- Retire giant color bands. Standard compact header everywhere:
  title (h1 28-32px) + description line + right-aligned action row,
  inside container, 24px top gap (existing) + 24px bottom.
- Empty states (dashboard logged-out, orders empty, exceptions empty,
  parcels/shipments/statements empty): centered white card, 48px icon in
  neutral tile, headline, one-line explanation, primary + secondary
  actions (e.g. Sign in / Sync Shopify orders / Scan a parcel).
- Login: white card on light gray-blue canvas (#f8fafc page bg), rest
  unchanged.

## 9. Data display
- Tables: sticky thead on scroll, row hover tint, 14px, tabular numbers,
  status pills (tinted bg + ink/700 text), horizontal scroll wrapper
  retained, min-widths kept so mobile scrolls instead of crushing.
- KPI cards: white, label uppercase 12px muted, 28px semibold value with
  .tnum, delta line (▲/▼ + % + muted caption), sparkline ink/accent.
- Badges keep tint system (§4); SeverityBadge maps
  CRITICAL error / HIGH warning-orange / MEDIUM info-blue / LOW neutral.

## 10. Landing (`app/page.tsx`, same IA, enterprise dress)
- Hero: 56px Inter 700 headline, subcopy, accent CTA + secondary, right
  product-mockup card (live dashboard fragment: KPI row + mini ledger
  table + sync status chip) instead of illustration scene. ClayScene
  retired from landing (keep component file only if used elsewhere,
  else delete with its test).
- Metric strip (orders synced / parcels scanned / exceptions resolved /
  uptime) with .tnum.
- Features 3-up white hairline cards with SVG icons; workflow band;
  testimonials 3-up white; pricing 3-up white + featured accent-outline
  tier (no dark/teal fill); CTA band light; footer light neutral with
  sitemap columns (no mountain scene).
- All 5 nav anchors must still resolve (keep section ids).

## 11. Motion (CSS-only, no new deps)
- Reveal 250ms fade-rise; stagger ≤60ms; buttons press only; dropdowns
  150ms fade; `prefers-reduced-motion` static everywhere.

## 12. Testing
- `cd frontend; npm test` (update: tokens raw-CSS to enterprise values;
  nav grouped items + dropdown + active trail; landing enterprise
  assertions; ClayScene test removed only if component deleted;
  no-#101010/no-Clay-hex assertions) + `npm run build` (24+ pages).
- Playwright re-screenshots (landing desktop/mobile, dashboard,
  orders, scan dispatch) compared against §2 evidence: nav fits one row,
  no blank voids, empty states actionable, no horizontal scroll at 390px.

## 13. Out of scope
Backend/API/IA changes; sidebar; dark mode; GSAP; new deps; validation
beyond focus/error; print styles (other session owns labels).
