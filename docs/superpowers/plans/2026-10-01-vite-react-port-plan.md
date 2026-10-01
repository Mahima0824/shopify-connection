# Vite + React Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Next.js frontend as a Vite + React SPA in `web/`, pixel-identical, same backend.

**Architecture:** Fresh Vite scaffold, then copy-then-swap: lib/styles/components first (mechanical import swaps), then pages in three batches with their tests, then verification (suite + build + screenshot parity). `frontend/` untouched throughout.

**Tech Stack:** Vite 6, React 18.3.1, react-router-dom v6, TypeScript 5.4, vitest 2 + jsdom + Testing Library. No other new dependencies.

## Global Constraints

- New code lives ONLY in `web/` — never modify `frontend/`, `backend/`, or docs except the plan/spec itself.
- UI pixel-identical: no visual, copy, or behavior changes except the §6 swap list in spec `docs/superpowers/specs/2026-10-01-vite-react-port-design.md`.
- Every `api()` call, handler, and localStorage key byte-identical.
- React 18.3.1 + react-dom 18.3.1 (same as frontend); TypeScript strict, noUnusedLocals OFF.
- `.env` (real keys) never committed — only `.env.example` with placeholders.
- All 24 ported test files must pass; `npm run build` = `tsc --noEmit && vite build` with zero errors.

---

### Task 1: Scaffold + shell + route table

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/.env.example`, `web/.gitignore`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/pages/NotFound.tsx`, `web/src/vite-env.d.ts`
- Test: `web/tests/shell.test.tsx`

**Interfaces:**
- Consumes: nothing (greenfield).
- Produces: installable project; `App` with BrowserRouter + AppShell (TopNav placeholder import — TopNav arrives Task 2, so AppShell temporarily renders a stub `<nav>ReconHub</nav>`; Task 2 replaces it); full 28-route table rendering per-route placeholder text.

- [ ] **Step 1: Scaffold the project**

Run (from repo root):

```bash
npm create vite@latest web -- --template react-ts
```

If scaffolding is unavailable offline, hand-create the files below instead. Then set `web/package.json`:

```json
{
  "name": "recon-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "@zxing/browser": "0.2.1",
    "@zxing/library": "0.23.0",
    "bwip-js": "4.11.4",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "react-router-dom": "^6.28.0"
  },
  "devDependencies": {
    "@testing-library/react": "16.1.0",
    "@types/node": "^20.12.12",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "25.0.1",
    "typescript": "^5.4.5",
    "vitest": "^2.1.9"
  }
}
```

`web/vite.config.ts`:

```ts
/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom" },
});
```

`web/tsconfig.json`: strict true, `moduleResolution: "bundler"`, `jsx: "react-jsx"`, `noUnusedLocals: false`, `types: ["vite/client"]`, include `src`. `web/.gitignore`: `node_modules/`, `dist/`, `.env` (allow `.env.example`). `web/.env.example`:

```
VITE_API_URL=http://localhost:8000
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

`web/index.html`: title "ReconHub — Shopify Order & Accounting Reconciliation", meta description + viewport `width=device-width, initial-scale=1`, Google Fonts preconnect + css2 link (Plus Jakarta Sans 500;600 + Inter 400;500;600), `<div id="root">`, `<script type="module" src="/src/main.tsx">`.

`web/src/main.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

`web/src/App.tsx`: BrowserRouter + Routes with all 28 paths from spec §5, each rendering a temporary `<div data-route="...">` placeholder EXCEPT `/login` etc. — all placeholders this task; AppShell with stub nav + `<main style={{ paddingTop: 24 }}><Outlet /></main>` + `*` → NotFound (simple centered message + Link to `/`). `web/src/pages/NotFound.tsx` + `web/src/vite-env.d.ts` (`/// <reference types="vite/client" />`).

- [ ] **Step 2: Write the failing test**

```tsx
// web/tests/shell.test.tsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App";

test("shell renders nav and outlet for unknown route", () => {
  render(
    <MemoryRouter initialEntries={["/nope"]}>
      <App />
    </MemoryRouter>
  );
  expect(screen.getByText(/ReconHub/i)).toBeTruthy();
});
```

Note: App must NOT create its own BrowserRouter for this test to work — structure App as `<AppShell/>` route tree exported WITHOUT router, plus default export wrapping in BrowserRouter:

```tsx
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<div data-route="landing" />} />
        {/* ... all 28 ... */}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
```

Test imports `{ AppRoutes }` and wraps in MemoryRouter. (Adjust the Step-2 snippet accordingly: `import { AppRoutes } from "../src/App"`.)

- [ ] **Step 3: Install and run test to verify it fails**

Run (from `web/`): `npm install`, then `npm test -- tests/shell.test.tsx`
Expected: FAIL (TopNav stub text differs / routes missing — any fail; the point is red first).

- [ ] **Step 4: Implement until green**

Fill AppShell + all 28 placeholder routes + NotFound per above.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/shell.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat: scaffold Vite React app with route table"
```

### Task 2: Port lib + styles + components

**Files:**
- Create: `web/src/lib/*.ts` (8 files, copies), `web/src/styles/globals.css` (copy minus font `@import`), `web/src/components/*.tsx` + `web/src/components/scanner/*` + `web/src/components/barcode/*` (16 files incl. `Loading.tsx` ported from `frontend/app/loading.tsx` minus directives)
- Test: existing component tests ported: `web/tests/timeline.test.tsx`, `web/tests/scan-sound.test.tsx`, `web/tests/barcode-scanner.test.tsx`

**Interfaces:**
- Consumes: Task 1 shell.
- Produces: swapped primitives Tasks 3-5 import: `Link→react-router`, `useLocation().pathname` (TopNav), `VITE_` env (api.ts), no `"use client"` lines anywhere.

- [ ] **Step 1: Copy and swap**

Copy `frontend/lib/*` → `web/src/lib/`, `frontend/components/*` → `web/src/components/` (keep subdirs), `frontend/app/loading.tsx` → `web/src/components/Loading.tsx`, `frontend/app/globals.css` → `web/src/styles/globals.css` minus the first `@import` line. Then apply swaps:
  - Delete every `"use client";` line.
  - `import Link from "next/link"` → `import { Link } from "react-router-dom"`; change each `<Link href=` to `<Link to=` (href= ONLY on Link elements — do not touch `a[href=` test selectors or other props).
  - TopNav: `import { usePathname } from "next/navigation"` → `import { useLocation } from "react-router-dom"`; `const pathname = usePathname();` → `const { pathname } = useLocation();`.
  - `frontend/lib/api.ts` line 1: `export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";` → `export const API = import.meta.env.VITE_API_URL ?? "http://localhost:8000";`.
  - Replace TopNav stub in AppShell with real TopNav import.

- [ ] **Step 2: Port the three component tests**

Copy `frontend/tests/timeline.test.tsx`, `scan-sound.test.tsx`, `barcode-scanner.test.tsx` → `web/tests/`, fixing relative imports (`../components/` → `../src/components/`, `../lib/` → `../src/lib/`).

- [ ] **Step 3: Run tests to verify they fail-then-pass**

Run: `npm test` (from `web/`)
Expected first run: FAIL (imports unresolved pre-swap). After swaps: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src web/tests
git commit -m "feat: port lib, styles and shared components"
```

### Task 3: Port pages batch A + tests

**Files:**
- Create: `web/src/pages/Landing.tsx` (from `app/page.tsx`), `Login.tsx`, `Dashboard.tsx` (from `app/dashboard/page.tsx`), `Orders.tsx`, `OrderDetail.tsx` (from `orders/[id]/page.tsx`), `Exceptions.tsx`
- Wire into `web/src/App.tsx` route table (replace 6 placeholders)
- Test: port `web/tests/landing.test.tsx`, `login` (none exists — skip), `dashboard.test.tsx`, `orders.test.tsx`, `exceptions.test.tsx` with fixed imports

**Interfaces:**
- Consumes: Task 2 primitives.
- Produces: 6 working routes.

- [ ] **Step 1: Copy, swap, wire**

Per page: copy, delete `"use client"`, Link href→to. Special cases:
  - Landing: default export rename to `Landing`; `/#product` hash link → `to="/#product"` (unchanged string, works natively).
  - Login (`app/login/page.tsx` lines 4,9): `import { useRouter } from "next/navigation"` → `import { useNavigate } from "react-router-dom"`; `const router = useRouter();` → `const navigate = useNavigate();`; `router.push("/dashboard")` → `navigate("/dashboard")`.
  - OrderDetail (`orders/[id]/page.tsx` line 13): `export default function OrderDetailPage({ params }: { params: { id: string } })` → `export default function OrderDetailPage() { const { id } = useParams();` + `import { useParams } from "react-router-dom"`; replace `params.id` → `id!` (4 usages: lines 21,25,28,31,34). `useEffect(load, [params.id])` dep → `[id]`.
  - Dashboard/orders/exceptions: Link swaps only.

- [ ] **Step 2: Port tests, run, expect failures first**

Copy the 4 test files with fixed `../src/` imports. nav-related mocks: none in these files. Run `npm test` → FAIL (routes/components missing pre-wire), wire App.tsx, re-run → PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages web/src/App.tsx web/tests
git commit -m "feat: port landing, login, dashboard, orders, exceptions"
```

### Task 4: Port pages batch B + tests

**Files:**
- Create: `web/src/pages/Parcels.tsx`, `ParcelDetail.tsx` (`parcels/[barcode]`, `useParams().barcode`), `ParcelLabels.tsx`, `ParcelTestSheet.tsx`, `ScanHub.tsx` (`scan/page.tsx`), `Dispatch.tsx`, `ReturnScan.tsx` (`scan/return`), `RtoScan.tsx`, `Shipments.tsx`, `ShipmentDetail.tsx` (`useParams().id`), `Outstanding.tsx`
- Wire 11 routes into App.tsx
- Test: port `scan.test.tsx`, `return.test.tsx`, `shipments.test.tsx`, `barcode.test.tsx`, `scanner.test.tsx`

**Interfaces:** Consumes Task 2. Same swap rules; `params.barcode` → `useParams().barcode!` (parcels/[barcode] lines 15,49,58); `window.location.reload()` calls stay verbatim (lines 63,71).

- [ ] **Step 1: Copy, swap (incl. useParams), wire App.tsx**
- [ ] **Step 2: Port tests with fixed imports; run `npm test` → red-then-green**
- [ ] **Step 3: Commit**

```bash
git add web/src/pages web/src/App.tsx web/tests
git commit -m "feat: port parcels, scan and shipments routes"
```

### Task 5: Port pages batch C + remaining tests

**Files:**
- Create: `web/src/pages/StatementList.tsx`, `StatementDetail.tsx` (`useParams().id`, statements/[id] lines 6,13,17,21,30), `MonthlyReport.tsx`, `TallySettings.tsx`, `CostsSettings.tsx`, `CarriersSettings.tsx`, `SlaSettings.tsx`, `Import.tsx`, `FinanceClose.tsx`, `FinanceLedger.tsx`, `Tracking.tsx`
- Wire 11 routes into App.tsx
- Test: port remaining 13 test files (`responsive`, `tokens`, `nav` with MemoryRouter, `tally`, `tally-export`, `statements`, `statements-recon`, `month-close`, `ledger`, `fe5-reports-shipments`, `import`, `loading`, `tracking`, `return` if unported) with fixed imports; nav.test: replace `vi.mock("next/navigation")` with `<MemoryRouter initialEntries={["/dashboard"]}>` wrapper and drop the mock import.

**Interfaces:** Consumes Tasks 1-4. After this task ALL 29 routes + ALL 24 tests exist in `web/`.

- [ ] **Step 1: Copy, swap, wire**
- [ ] **Step 2: Port tests; run `npm test` → red-then-green (full suite)**
- [ ] **Step 3: Commit**

```bash
git add web/src web/tests
git commit -m "feat: port statements, reports, settings, import, finance, tracking"
```

### Task 6: Verification (build + parity)

**Files:** fix only what verification breaks (anywhere in `web/`).

- [ ] **Step 1: Full suite**

Run (from `web/`): `npm test`
Expected: PASS all 24+ files.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: `tsc --noEmit` clean + `vite build` emitting `dist/`, no errors. Fix type errors (common: unused React import with `jsx: react-jsx` — remove; `import.meta.env` typing via `src/vite-env.d.ts`).

- [ ] **Step 3: Visual parity screenshots**

Serve both apps (`npm run dev` in `frontend/` on :3000 if free, `web/` on :5173) and screenshot landing, dashboard (logged-out empty state), orders empty state, scan dispatch at desktop width; side-by-side compare: same layout/copy/spacing. Serve `web/dist` via `npm run preview` for one pass to confirm production output works.

- [ ] **Step 4: Commit fixes**

```bash
git add web
git commit -m "fix: verification findings from build and parity check"
```
