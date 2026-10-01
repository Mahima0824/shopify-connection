# Next.js → Vite + React Port — Design Spec
Date: 2026-10-01
Status: approved (Approach A: clean Vite port, pixel-identical)
Skills: brainstorming (process)

## 1. Goal
Rebuild `frontend/` (Next.js 14) as `web/` (Vite + React 18 + react-router-dom),
pixel-identical UI, same FastAPI backend, zero behavior change. `frontend/`
stays untouched and runnable (other session active there) until an explicit
later cutover, which is out of scope.

## 2. Context (evidence)
- 28 pages under: `frontend/app/**/page.tsx`, 26 already `"use client"`;
  remaining 2 (`app/page.tsx`, `app/scan/page.tsx`) are static markup, trivially client-safe.
- Zero Next-only features (no next/image, next/font, metadata API, server
  actions, middleware, route handlers). Only Next imports repo-wide:
  `next/link` (Link) and `next/navigation` (useRouter, usePathname).
- Deps to carry: react 18.3.1, react-dom 18.3.1, @zxing/browser 0.2.1,
  @zxing/library 0.23.0, bwip-js 4.11.4. New dep: react-router-dom v6
  (pinned at implementation time). DevDeps: typescript, vitest,
  @testing-library/react, jsdom, @types/* (same versions).
- Lib: api.ts, app-nav.ts, barcode.ts, return-options.ts, scan-debounce.ts,
  scan-sound.ts, sla.ts, tracking.ts — all framework-free already.
- Env in use: NEXT_PUBLIC_API_URL (default http://localhost:8000),
  NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY.
- Toolchain present: Node v24.13.0, npm 11.6.2 (Vite 6/7 compatible).

## 3. Decisions (user-confirmed)
- New `web/` folder alongside `frontend/` (no collisions).
- Pixel-identical port; backend untouched; cutover later (out of scope).

## 4. Structure (`web/`)
- `index.html` — title "ReconHub — Shopify Order & Accounting
  Reconciliation", meta description + viewport, Google Fonts preconnect +
  stylesheet links (Plus Jakarta Sans 500;600 + Inter 400;500;600),
  `<div id="root">`, `/src/main.tsx` script tag.
- `src/main.tsx` — createRoot render of `<App/>`, `import "./styles/globals.css"`.
- `src/App.tsx` — BrowserRouter + AppShell (TopNav + `<main
  style={{paddingTop: 24}}>` + `<Outlet/>` + Suspense fallback) + full
  route table (§5).
- `src/pages/` — one module per route, mirrored from `app/**`
  (e.g. `src/pages/orders/[id]` becomes `src/pages/orders/OrderDetail.tsx`;
  exact filenames fixed in plan).
- `src/components/`, `src/lib/` — copied verbatim then swapped per §6.
- `src/styles/globals.css` — copied; font `@import` line removed (fonts
  come from index.html); all classes/tokens/breakpoints unchanged.
- `.env` — VITE_API_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
  (same values as frontend/.env.local).
- `.env.example` — committed with placeholder values; real `.env` stays
  gitignored (never commit real keys).
- `vite.config.ts` (react plugin, `/// <reference types="vite/client" />`),
  `vitest.config.ts` (jsdom, same as frontend), `tsconfig.json`
  (strict, bundler resolution, noUnusedLocals OFF to match frontend
  tolerance), `package.json` (dev/build/test/preview scripts).

## 5. Route table (28 + NotFound)
`/` Landing · `/login` · `/dashboard` · `/orders` · `/orders/:id` ·
`/parcels` · `/parcels/labels` · `/parcels/test-sheet` · `/parcels/:barcode` ·
`/scan` · `/scan/dispatch` · `/scan/return` · `/scan/rto` · `/shipments` ·
`/shipments/outstanding` · `/shipments/tracking` · `/shipments/:id` ·
`/statements` · `/statements/:id` · `/reports/monthly` · `/exceptions` ·
`/import` · `/finance/close` · `/finance/ledger` · `/tracking` ·
`/settings/tally` · `/settings/costs` · `/settings/carriers` · `/settings/sla`.
Dynamic segments via `useParams()` (id, barcode). Catch-all `*` →
  NotFound page (simple EmptyState linking `/`; Next.js had none — small
  deliberate addition, only new UI in scope).

## 6. Mechanical swaps (exhaustive)
- `import Link from "next/link"` → `import { Link } from "react-router-dom"`
  (props unchanged: `to` accepts the same strings — codemod `href=` to
  `to=` on Link elements only).
- `const router = useRouter(); router.push(x)` → `const navigate =
  useNavigate(); navigate(x)`. `router.replace` (if any — grep; none
  known) → `navigate(x, { replace: true })`.
- `usePathname()` → `const { pathname } = useLocation()` (TopNav only).
- Delete every `"use client";` line.
- `process.env.NEXT_PUBLIC_API_URL` → `import.meta.env.VITE_API_URL`
  (keep `?? "http://localhost:8000"` fallback); same pattern for the two
  Supabase keys. Add `/// <reference types="vite/client" />` for
  `import.meta.env` typing.
- `app/loading.tsx` → `<Suspense fallback={<Loading/>}>` around Outlet
  (Loading component copied to `src/components/Loading.tsx`).
- `app/layout.tsx` metadata/viewport → index.html tags; TopNav + main
  paddingTop → AppShell.
- Fonts `@import` → index.html links (drop the CSS line to avoid double
  fetch + build warning).
- `next-env.d.ts` dropped. `next.config.mjs` has no equivalent (default
  Vite behavior covers it; no rewrites/proxies in use).

## 7. Tests
- Copy all 24 `frontend/tests/*` to `web/tests/*`, updating relative
  import paths (`../app/...` → `../src/...`).
- Router-dependent tests: replace `vi.mock("next/navigation", ...)` with
  `MemoryRouter initialEntries={[...]}` wrappers (nav.test.tsx,
  dashboard tests rendering TopNav if any). All other assertions verbatim.
- `npm test` (vitest run) must pass fully before build.

## 8. Verification
- `npm test` green; `npm run build` = `tsc --noEmit && vite build`,
  dist/ output, no type errors.
- Visual parity: serve `web/dist` (or dev) + screenshot landing,
  dashboard, orders, scan dispatch at desktop + mobile; compare against
  the Next.js app. No pixel-perfect tooling — human side-by-side.
- Backend contract unchanged (same envelope, same localStorage token).

## 9. Out of scope
Deleting/renaming `frontend/`; cutover decision; backend changes; new
features; PWA/service worker; SSR/SEO (explicitly abandoned with Next.js
— landing becomes client-rendered like everything else already is).
