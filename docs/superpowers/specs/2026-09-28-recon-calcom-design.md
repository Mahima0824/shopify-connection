# ReconHub Cal.com UI Refactor — Design Spec
Date: 2026-09-28
Status: approved

## 1. Goal
Full refactor of `frontend/` from dark glass/indigo to Cal.com marketing system (white canvas, black CTA, light-gray cards, dark footer only). Add public landing `/`, remove sidebar, use top-nav everywhere. Unique product-chrome cards, CSS-only motion.

## 2. Context
- Next.js 14 App Router, 10 routes: `/login`, `/dashboard`, `/orders`, `/orders/[id]`, `/scan/dispatch`, `/scan/return`, `/exceptions`, `/settings/tally`, `/parcels/[barcode]`, `/` (currently redirects to `/login`).
- 6 components: Navbar (dark sidebar), MetricCard, OrderTable, ScanBanner, SeverityBadge, Timeline.
- `globals.css` vanilla, no Tailwind, no motion lib. Tests: `npm test` (vitest), build: `npm run build`.
- design.md tokens: canvas #ffffff, primary #111111, primary-active #242424, surface-card #f5f5f5, surface-soft #f8f9fa, hairline #e5e7eb, dark #101010, dark-elevated #1a1a1a, ink #111111, body #374151, muted #6b7280, on-dark-soft #a1a1aa, accent blue #3b82f6 sparingly, pastels orange #fb923c / pink #ec4899 / violet #8b5cf6 / emerald #34d399.

## 3. Decisions
- Scope: full refactor (landing + app), user-confirmed.
- Nav: top-nav only, no sidebar, user-confirmed.
- Motion: CSS keyframes + IntersectionObserver, no new deps (Approach A). Respects design.md no-hover rule, prefers-reduced-motion support.

## 4. Tokens / Base (`app/globals.css` rewrite)
- CSS vars for all colors above, spacing 4/8/12/16/24/32/48/96, radius 6/8/12/16/pill/full.
- Fonts: Inter via next/font or Google import; display class `.display` weight 600 letter-spacing -0.04em (Cal Sans substitute). Body Inter 400.
- Type scale: display-xl 64/1.05/-2px, display-lg 48/1.1/-1.5px, display-md 36/1.15/-1px, display-sm 28/1.2/-0.5px, title-lg 22/600, title-md 18/600, body-md 16/400/1.5, body-sm 14, caption 13/500, button 14/600, nav-link 14/500.
- Buttons: `.btn-primary` #111 white text 12x20 40px 8px; active #242424 translateY(1px). `.btn-secondary` white hairline. `.btn-icon-circular` 36px circle. Text-link monochrome underline on hover only for context.
- Inputs: `.input-control` white, hairline, 10x14 40px 8px; focus border ink.
- Badges: `.badge-pill` 4x12 pill caption; pastel variants for categories; severity maps to pastel dot + monochrome label (not full-color slam).
- Layout: `.container` max 1200 centered, section padding 96px, card grids 3-up/4-up collapsing 2-up tablet 1-up mobile.

## 5. Navigation
- `components/TopNav.tsx` (new, replaces `Navbar.tsx` sidebar): 64px white, left wordmark (black dot + ReconHub), center links Product/Solutions/Resources/Pricing/Enterprise (anchor to landing sections on `/`, real routes in app), right Sign in text-link + Sign up free primary + mobile hamburger.
- `components/NavPillGroup.tsx` (new): surface-soft pill wrapper 6px padding, segments Dashboard/Orders/Dispatch/Returns/Exceptions/Tally, active white pill + subtle shadow, sliding indicator 200ms. Used below TopNav in app layout, and as mode switcher Personal/Teams/Enterprise on landing.
- `app/layout.tsx`: remove `.app-container`/sidebar flex, render TopNav + NavPillGroup (pill only when not `/` or `/login`) + `<main class=container>`.
- Mobile <768px: hamburger full-sheet, hero 7/5 to single column, grids 1-up, footer 4→1.

## 6. Landing `/` (replaces redirect)
File: `app/page.tsx` rewrite, sections:
1. hero-band 7/5: left h1 display-xl + sub body-md + button row, right hero-app-mockup-card (white, hairline, 16px, shadow) with live fragments: mini order row, barcode scan input + Confirm, Tally badge. Slots cascade stagger 80ms on load.
2. Logos / trust strip hairline-soft divider.
3. Feature 3-up gray feature-card (Sync/Scan/Reconcile) each with icon + title-md + body + tiny product fragment (not illustration).
4. Product-mockup band: white product-mockup-card showing exceptions queue + automation flow, side copy.
5. Testimonials 3-up testimonial-card gray, avatar-circle 36px pastel initials, stars orange.
6. Pricing 4-up: 3 white tier-cards + 1 featured dark (#101010 white text).
7. cta-band-light gray 48px padding centered + primary CTA.
8. footer dark #101010, 4 cols, wordmark white, links on-dark-soft, 64px padding.

## 7. App components (rebuild, unique)
- `MetricCard.tsx`: white hairline 12px 20px padding, uppercase caption label, 28px value, trend emerald/error + tiny inline SVG sparkline (unique per metric via prop points). No glass.
- `OrderTable.tsx`: white card wrapper, modern-table light header (soft bg, muted uppercase 12px), rows hairline dividers, monochrome status pills + pastel dot, INR amounts ink 600, View Timeline secondary small.
- `Timeline.tsx`: vertical line hairline, dots pastel by event type, cards white with timestamp caption.
- `ScanBanner.tsx`: input-control + primary Confirm pattern matching hero mockup, success emerald inline, error red inline.
- `SeverityBadge.tsx`: badge-pill mapping R001-R008 to pastel dot, monochrome text.
- `Navbar.tsx`: delete sidebar, replaced by TopNav (keep file removed or re-export for tests).

## 8. Motion
- Utilities in globals.css: `@keyframes fadeUp {from opacity 0 translateY 12px}`, `.reveal` initial hidden, `.reveal.is-visible` animate 600ms ease-out once.
- `components/Reveal.tsx` + `lib/useReveal.ts`: IntersectionObserver adds is-visible, unobserves after.
- Hero stagger via `--stagger-index` delay 80ms. Metric count-up via `lib/useCountUp.ts` rAF 800ms. Nav-pill indicator transform 200ms. Button press only. `prefers-reduced-motion: reduce` disables all.
- No parallax, no infinite gradients, no hover lifts beyond press.

## 9. Data flow / Error handling
- No API change. All pages keep existing fetch to `NEXT_PUBLIC_API_URL` envelope. Empty states keep copy but light styling. Auth login stays `/login` restyled light card centered.
- Forms validate inline, error red text + hairline red border.

## 10. Testing
- `cd frontend; npm test; npm run build`. Update existing vitest snapshots if class names change. Manual: desktop 1440, tablet 800, mobile 390; check 96px rhythm, dark only footer + featured pricing, contrast ink on white AA.

## 11. Out of scope
- Backend changes, API contracts, Cal Sans license, booking widget product surface, form validation beyond focus/error, animation timings beyond above.
