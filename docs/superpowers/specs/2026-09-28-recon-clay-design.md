# ReconHub Clay Re-theme — Design Spec
Date: 2026-09-28
Status: approved
Skills: brainstorming (process), ui-ux-pro-max (design intelligence)

## 1. Goal
Re-theme `frontend/` from the Cal.com white/monochrome system to the Clay.com
warm-playful system (cream canvas, saturated 6-color feature cards, rounded
display type, crafted SVG illustration scenes, cream footer). Every component
changes, guided per-component by ui-ux-pro-max rules (contrast, 44px targets,
SVG icons, focus visibility, reduced motion). No API/backend changes.

## 2. Context
- Next.js 14 App Router, vanilla CSS, vitest. Tests: `npm test`, build: `npm run build` (from `frontend/`).
- Current chrome (post Cal.com refactor): `TopNav`, `NavPillGroup`, `Reveal`
  (IntersectionObserver), `Footer` (dark #101010), landing `/` (hero mockup,
  3-up features, testimonials, 4-up pricing w/ dark featured, CTA, footer),
  5 shared components (MetricCard, OrderTable, SeverityBadge, Timeline,
  ScanBanner), 9 app routes, `lib/app-nav.ts`, `lib/api.ts` envelope.
- Clay design.md tokens (verbatim): canvas #fffaf0, primary #0a0a0a,
  pink #ff4d8b, teal #1a3a3a, lavender #b8a4ed, peach #ffb084, ochre #e8b94a,
  mint #a4d4c5, coral #ff6b5a, soft #faf5e8, card #f5f0e0, strong #ebe6d6,
  dark #0a1a1a, dark-elevated #1a2a2a, hairline #e5e5e5, ink #0a0a0a,
  body-strong #1a1a1a, body #3a3a3a, muted #6a6a6a, muted-soft #9a9a9a,
  on-primary #ffffff, success #22c55e, warning #f59e0b, error #ef4444.
- ui-ux-pro-max research (2026-09-28): playful-SaaS direction confirmed;
  skill palette defaults rejected in favor of design.md hexes. Adopted from
  skill: Plus Jakarta Sans (rounded, friendly SaaS) as Plain Black
  substitute; 44px targets; SVG-not-emoji icons; visible focus; 4.5:1 body
  contrast; reduced-motion final-state; 375/768/1024/1440 checks.

## 3. Decisions (user-confirmed)
- Scope: full re-theme, landing + app (Approach A).
- Illustrations: hand-crafted inline SVG mountain/mascot scenes in Clay
  palette, unique to ReconHub, zero deps (no 3D assets exist).
- Display face: Plus Jakarta Sans 500 (not Inter) — rounded warmth closest
  to Plain Black; body stays Inter.

## 4. Tokens / Base (`app/globals.css` rewrite)
- Vars for every color above; spacing 4/8/12/16/24/32/48/96; section 96px;
  container 1280px centered.
- Fonts: Plus Jakarta Sans 500 (display, -0.05em tracking substitute) +
  Inter 400/500/600 (body/UI) via Google Fonts import. `.display` 500 weight
  ONLY (never 700).
- Scale: display-xl 72/1.0/-2.5px, display-lg 56/1.05/-2px, display-md
  40/1.1/-1px, display-sm 32/1.15/-0.5px, title-lg 24/600/-0.3px, title-md
  18/600, title-sm 16/600, body-md 16/400/1.55, body-sm 14/400/1.55, caption
  13/500, caption-uppercase 12/600/1.5px tracking, button 14/600, nav-link
  14/500.
- Buttons: `.btn-primary` #0a0a0a white text, 12x20 padding, 44px height,
  12px radius. `.btn-secondary` cream + hairline. `.btn-on-color` white bg
  ink text (over saturated cards). Press state darkens; no hover styling.
- Inputs: cream bg, ink text, 12x16 padding, 44px height, 12px radius,
  hairline border; focus border thickens to ink + `:focus-visible` 2px ink
  outline offset 2px (ui-ux-pro-max P1, additive).
- Cards: `.feature-card-{pink,teal,lavender,peach,ochre,cream}` 24px radius,
  32px padding; `.content-card` cream/white hairline 16px radius 24px
  padding; `.badge-pill` cream 9999px caption.
- Text on saturated cards: pink/teal → white headings ONLY at display
  sizes (large-text 3:1); all body copy sits in white fragment chips with
  ink text (holds 4.5:1). Lavender/peach/ochre/cream → ink text directly.
- Motion: fadeUp retuned to rise+scale 400ms; `.reveal` + stagger via
  `animation-delay`; `prefers-reduced-motion` renders final state, no
  animation. Reveal.tsx keeps IntersectionObserver once-only behavior.
- Never inline hex in components; never repeat a card color twice in a row
  on a page; max 6 brand colors total.

## 5. Navigation
- `TopNav`: cream canvas bg, ink wordmark + parcel-mascot SVG dot, center
  links Product/Solutions/Resources/Pricing/Customers (Inter 14/500), right
  Sign in text-link + Try free primary 44px. Hamburger <768px full sheet.
- `NavPillGroup` → category-tab treatment: transparent inactive muted text;
  active cream-card `#f5f0e0` ink text, 8x16 padding, pill radius. Same
  `items/active` props. App pages keep per-route active hrefs.
- `layout.tsx`: unchanged structure (TopNav + plain main); container owned
  per page/band.

## 6. Illustration system (`components/ClayScene.tsx`, new)
- One component, variants via prop: `mountains` (hero: layered ochre/peach/
  lavender ranges + sun + parcel-mascot), `horizon` (footer: low mountain
  strip). Exactly two variants (YAGNI).
- Inline SVG, palette hexes only, rounded blob shapes, soft flat shading
  (stacked translucent paths imply clay depth). No external assets, no deps.
- Mascot: rounded parcel-box character (ochre body, ink face, mint tape) —
  reused at small size in login card + CTA band.

## 7. Landing (`app/page.tsx` rewrite of bands, same IA)
1. hero-band 7/5 cream: display-xl h1 + lead + black CTA + secondary; right
   hero-illustration-card (soft bg, 24px) with `ClayScene mountains`.
2. Trust strip hairline divider.
3. Features 3-up saturated cycle (pink Sync / teal Scan / lavender
   Reconcile), each with ReconHub product fragment in white chip.
4. Product band: cream product-mockup-card with exceptions queue +
   sequencer flow fragments; side copy display-lg.
5. How-it-works 3-up cycle continues (peach / ochre / cream) — no color
   repeated adjacently with section 3.
6. Testimonials 3-up cream testimonial-cards, 36px pastel avatars.
7. Pricing 3-4 up: white/hairline tiers + featured teal tier (white text,
   large-size only + white chips for feature list).
8. cta-band-illustrated: soft bg, 24px, 80px padding, display-md + primary
   CTA + mascot.
9. Footer cream `#faf5e8`, ink headings, body-strong links, 4 cols, 80px
   padding, `ClayScene horizon` at bottom. NO dark footer (destroys old
   dark Footer visual; keep component file, rewrite styles).

## 8. App components (all rebuilt, props preserved)
- `MetricCard`: cream card 16px, caption-uppercase label, display-sm ink
  value, SVG sparkline (ink stroke), SVG icon chip tinted per metric
  (pastel fills, ink glyphs). Keeps `points?` prop.
- `OrderTable`: white wrapper hairline 16px; thead soft bg muted uppercase;
  status pills pastel dot + ink text; INR ink 600; View Timeline secondary.
  Dedupes thead inline styles into `.modern-table` (fixes Task-4 debt).
- `SeverityBadge`: badge-pill + palette dot (CRITICAL coral/red, HIGH
  orange/peach-deep, MEDIUM violet, LOW mint/teal).
- `Timeline`: cream rail line, palette dots by kind, white fragment cards.
- `ScanBanner`: cream card + 4px status border, ink text, roles preserved.
- Icons: all emoji (📦🏷️🔄⚠️💰🧾🚚💸✨) replaced with inline SVG strokes
  (ui-ux-pro-max no-emoji rule). New `components/icons.tsx` (one file,
  stroke=currentColor, 16-20px viewBox 24).
- `Reveal`: unchanged behavior; retuned CSS timing only.

## 9. App routes (styling only, api/handlers byte-identical)
- Canvas cream everywhere; per-route signature saturated moment (band or
  header card, 24px): dashboard peach band, dispatch ochre, return
  lavender, exceptions pink-tint state cards, tally teal accents, orders
  cream w/ ochre sync CTA band, order detail + parcels cream fragment
  cards, login centered white card on cream + mascot.
- NavPillGroup active hrefs unchanged. Data tables stay white/cream for
  contrast. No dark surfaces anywhere (retire dark scrim → cream scrim
  rgba(250,245,232,.85)).

## 10. Motion (CSS-only, no new deps)
- Reveal rise+scale 400ms ease-out, stagger 70ms via animation-delay.
- Buttons press only. Nav-pill 200ms indicator (keep). Count-up keep.
- `prefers-reduced-motion`: final state, zero animation.

## 11. Testing
- `cd frontend; npm test` (update snapshots for class/style changes;
  strengthen: raw-CSS token assertions, footer cream-not-dark, featured
  teal, card-cycle order) + `npm run build`.
- Manual 375/768/1024/1440: hamburger, hero stack (72→36px), grids
  3→2→1, pricing→1-up, footer→1-up, no horizontal scroll, contrast spot
  check (body copy 4.5:1, display 3:1).

## 12. Out of scope
Backend/API, IA/route changes, real 3D assets, GSAP (CSS-only per motion
constraint), validation beyond focus/error, product-surface (in-app tables)
token work.
