# Fix report — final-review findings (2026-09-28)

## What changed per finding
1. Footer 4-col overflow (Important): `frontend/components/Footer.tsx` — added `footer-grid` class to grid div, removed inline `gridTemplateColumns` (kept `display:grid`, `gap`). `frontend/app/globals.css` — added `.footer-grid{display:grid;grid-template-columns:1.5fr 1fr 1fr 1fr;gap:32px}` and `.footer-grid{grid-template-columns:1fr !important;}` inside existing `@media (max-width:768px)` block.
2. Reveal stagger inert (Important): `frontend/components/Reveal.tsx` — changed `transitionDelay` to `animationDelay` (kept `className="reveal"`). Verified `globals.css` `.reveal.is-visible` uses `animation:fadeUp ...`, so `animationDelay` now applies to the stagger.
3. Pill group overflow (Important): `frontend/components/NavPillGroup.tsx` — wrapper added `maxWidth:"100%"`, `overflowX:"auto"`; segments added `whiteSpace:"nowrap"`, `flexShrink:0`. Inline-style edit only.
4. Hero Confirm span (Minor): `frontend/app/page.tsx:47` — replaced `<span className="btn-primary">Confirm</span>` with `<button type="button" className="btn-primary">Confirm</button>` (same styling, mockup fragment, no handler).

## Tests run
- Exact command: `npm test` (workdir `frontend/`). Output: `Test Files 10 passed (10)`, `Tests 14 passed (14)`, vitest v2.1.9, Duration 2.27s.
- Exact command: `npm run build` (workdir `frontend/`, single attempt — passed first try, no retry needed). Output: `✓ Compiled successfully`, `✓ Generating static pages (11/11)`, Next.js 14.2.35.
