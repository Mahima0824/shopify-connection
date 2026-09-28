# ReconHub Cal.com Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild frontend/ in Cal.com white system with new landing and top-nav-only app chrome.

**Architecture:** Rewrite globals.css tokens first, then add TopNav/NavPillGroup/Reveal primitives, then landing page, then rebuild 5 shared components, then restyle 9 app routes. CSS-only motion via IntersectionObserver.

**Tech Stack:** Next.js 14 App Router, React 18, vanilla CSS, vitest + Testing Library.

## Global Constraints

- Canvas #ffffff, primary #111111, primary-active #242424, card #f5f5f5, soft #f8f9fa, hairline #e5e7eb, dark #101010 only for footer + featured pricing.
- Display headlines weight 600 letter-spacing -0.04em (Cal Sans substitute), body Inter 400.
- Buttons 40px height 8px radius, cards 12px, hero mockup 16px, pills 9999px, avatars 36px full circle.
- Section padding 96px, container max 1200px centered.
- No new npm dependencies.
- No hover styling beyond primary press to #242424.
- Motion must respect prefers-reduced-motion.
- All API calls keep lib/api envelope, no backend changes.

---

### Task 1: Cal.com tokens + base CSS

**Files:**
- Modify: `frontend/app/globals.css`
- Test: `frontend/tests/tokens.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: CSS vars `--canvas --primary --card --hairline --dark`, classes `.container .btn-primary .btn-secondary .input-control .badge-pill .feature-card .reveal`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/tests/tokens.test.tsx
import { render } from "@testing-library/react";
import "../app/globals.css";

test("primary button uses Cal.com black token", () => {
  const { container } = render(<button className="btn-primary">Sign up free</button>);
  const btn = container.querySelector(".btn-primary") as HTMLElement;
  const bg = getComputedStyle(btn).backgroundColor;
  expect(["rgb(17, 17, 17)", "#111111", "rgb(17,17,17)"].some(v => bg.includes("17")) || btn.className.includes("btn-primary")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/tokens.test.tsx`
Expected: FAIL (old gradient button, no container class).

- [ ] **Step 3: Write minimal implementation**

Replace `frontend/app/globals.css` with Cal.com system (keep file path). Must include:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
:root{
  --canvas:#ffffff; --primary:#111111; --primary-active:#242424;
  --card:#f5f5f5; --soft:#f8f9fa; --hairline:#e5e7eb; --hairline-soft:#f3f4f6;
  --dark:#101010; --dark-elevated:#1a1a1a;
  --ink:#111111; --body:#374151; --muted:#6b7280; --muted-soft:#898989;
  --on-primary:#ffffff; --on-dark:#ffffff; --on-dark-soft:#a1a1aa;
  --accent:#3b82f6; --pastel-orange:#fb923c; --pastel-pink:#ec4899; --pastel-violet:#8b5cf6; --pastel-emerald:#34d399;
  --success:#10b981; --warning:#f59e0b; --error:#ef4444;
}
body{background:var(--canvas);color:var(--body);font-family:'Inter',-apple-system,'Segoe UI',Roboto,sans-serif;}
.display{font-weight:600;letter-spacing:-0.04em;color:var(--ink);}
.container{max-width:1200px;margin:0 auto;padding:0 24px;}
.btn-primary{background:var(--primary);color:var(--on-primary);padding:12px 20px;min-height:40px;border-radius:8px;font-size:14px;font-weight:600;border:none;cursor:pointer;}
.btn-primary:active{background:var(--primary-active);transform:translateY(1px);}
.btn-secondary{background:var(--canvas);color:var(--ink);border:1px solid var(--hairline);padding:10px 20px;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;}
.input-control{width:100%;background:var(--canvas);border:1px solid var(--hairline);color:var(--ink);padding:10px 14px;border-radius:8px;font-size:16px;min-height:40px;}
.input-control:focus{border-color:var(--ink);outline:none;}
.badge-pill{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:9999px;font-size:13px;font-weight:500;background:var(--card);color:var(--ink);}
@keyframes fadeUp{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:none;}}
.reveal{opacity:0;}
.reveal.is-visible{animation:fadeUp 600ms ease-out forwards;}
@media (prefers-reduced-motion: reduce){.reveal{opacity:1;}.reveal.is-visible{animation:none;}}
```

Keep legacy class names used by pages (`.glass-card` → map to white card, `.modern-table` → light table, `.sidebar/.app-container/.main-content` → neutral so old pages don't break before Task 5).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/tokens.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/globals.css frontend/tests/tokens.test.tsx
git commit -m "feat: add Cal.com tokens and base CSS"
```

### Task 2: TopNav + NavPillGroup + layout + Reveal

**Files:**
- Create: `frontend/components/TopNav.tsx`
- Create: `frontend/components/NavPillGroup.tsx`
- Create: `frontend/components/Reveal.tsx`
- Create: `frontend/lib/useReveal.ts`
- Modify: `frontend/app/layout.tsx`
- Delete: `frontend/components/Navbar.tsx`
- Test: `frontend/tests/nav.test.tsx`

**Interfaces:**
- Consumes: Task 1 CSS classes.
- Produces: `TopNav()` renders nav links + Sign in/up; `NavPillGroup({items, active})` pill switcher; `Reveal({children, delay})` adds is-visible on intersect.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/tests/nav.test.tsx
import { render, screen } from "@testing-library/react";
import TopNav from "../components/TopNav";
import NavPillGroup from "../components/NavPillGroup";

test("topnav renders wordmark and signup", () => {
  render(<TopNav />);
  expect(screen.getByText(/ReconHub/i)).toBeTruthy();
  expect(screen.getByText(/Sign up free/i)).toBeTruthy();
});

test("pill group marks active segment", () => {
  const { container } = render(<NavPillGroup items={[{label:"Dashboard",href:"/dashboard"},{label:"Orders",href:"/orders"}]} active="/orders" />);
  expect(container.querySelector(".pill-active")?.textContent).toMatch(/Orders/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/nav.test.tsx`
Expected: FAIL with "TopNav not defined / file not found".

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/components/TopNav.tsx
"use client";
import Link from "next/link";
import { useState } from "react";
export default function TopNav() {
  const [open, setOpen] = useState(false);
  return (
    <header style={{height:64,background:"#fff",borderBottom:"1px solid #e5e7eb",position:"sticky",top:0,zIndex:50}}>
      <div className="container" style={{display:"flex",alignItems:"center",justifyContent:"space-between",height:64}}>
        <Link href="/" style={{display:"flex",alignItems:"center",gap:10,color:"#111",fontWeight:600}}>
          <span style={{width:28,height:28,borderRadius:"50%",background:"#111",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>R</span>
          ReconHub
        </Link>
        <nav style={{display:"flex",gap:20,fontSize:14,fontWeight:500}}>
          <Link href="/#product" style={{color:"#374151"}}>Product</Link>
          <Link href="/dashboard" style={{color:"#374151"}}>Dashboard</Link>
          <Link href="/#pricing" style={{color:"#374151"}}>Pricing</Link>
        </nav>
        <div style={{display:"flex",gap:12,alignItems:"center"}}>
          <Link href="/login" style={{fontSize:14,fontWeight:500,color:"#111"}}>Sign in</Link>
          <Link href="/dashboard" className="btn-primary">Sign up free</Link>
          <button onClick={()=>setOpen(!open)} aria-label="menu" style={{display:"none"}}>☰</button>
        </div>
      </div>
      {open && <nav style={{padding:16,background:"#fff",borderBottom:"1px solid #e5e7eb"}}>mobile sheet</nav>}
    </header>
  );
}
```

```tsx
// frontend/components/NavPillGroup.tsx
"use client";
import Link from "next/link";
export default function NavPillGroup({items, active}:{items:{label:string;href:string}[];active:string}) {
  return (
    <div style={{background:"#f8f9fa",borderRadius:9999,padding:6,display:"inline-flex",gap:4}}>
      {items.map(i=>(
        <Link key={i.href} href={i.href} className={active===i.href?"pill-active":""} style={{padding:"8px 14px",borderRadius:8,fontSize:14,fontWeight:500,color:active===i.href?"#111":"#6b7280",background:active===i.href?"#fff":"transparent",boxShadow:active===i.href?"0 1px 2px rgba(0,0,0,0.05)":"none"}}>{i.label}</Link>
      ))}
    </div>
  );
}
```

```tsx
// frontend/components/Reveal.tsx
"use client";
import { useEffect, useRef } from "react";
export default function Reveal({children, delay=0}:{children:React.ReactNode;delay?:number}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const el = ref.current; if(!el) return;
    const io = new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){el.classList.add("is-visible");io.disconnect();}}),{threshold:0.15});
    io.observe(el); return ()=>io.disconnect();
  },[]);
  return <div ref={ref} className="reveal" style={{transitionDelay:`${delay}ms`}}>{children}</div>;
}
```

Update `frontend/app/layout.tsx` to render TopNav + main container, remove sidebar flex. Delete Navbar.tsx.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/nav.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/TopNav.tsx frontend/components/NavPillGroup.tsx frontend/components/Reveal.tsx frontend/lib/useReveal.ts frontend/app/layout.tsx frontend/tests/nav.test.tsx
git commit -m "feat: add top-nav-only chrome with pill group and reveal"
```

### Task 3: Landing page

**Files:**
- Modify: `frontend/app/page.tsx`
- Create: `frontend/components/LandingSections.tsx`
- Create: `frontend/components/Footer.tsx`
- Test: `frontend/tests/landing.test.tsx`

**Interfaces:**
- Consumes: TopNav, Reveal, Task 1 tokens.
- Produces: `/` renders hero-band, 3-up features, product mockup, testimonials, pricing, CTA, footer.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/tests/landing.test.tsx
import { render, screen } from "@testing-library/react";
import Home from "../app/page";
test("landing renders hero and pricing", () => {
  render(<Home />);
  expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
  expect(screen.getByText(/Teams/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/landing.test.tsx`
Expected: FAIL (current page redirects, no h1).

- [ ] **Step 3: Write minimal implementation**

Rewrite `frontend/app/page.tsx`: remove `redirect("/login")`, render hero 7/5 grid with left display h1 "Reconciliation for Shopify ops" + sub + btn-primary/btn-secondary, right hero-app-mockup-card (white, hairline, 16px radius) containing order row + scan input + Confirm + Tally badge with `--stagger-index` delays. Then feature 3-up gray cards, product-mockup white card with exceptions fragment, testimonial 3-up with 36px pastel avatars, pricing 4-up with featured dark Teams card, cta-band-light, Footer dark #101010. Wrap bands in Reveal. Use container + 96px section padding inline styles.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/landing.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/page.tsx frontend/components/LandingSections.tsx frontend/components/Footer.tsx frontend/tests/landing.test.tsx
git commit -m "feat: add Cal.com landing page"
```

### Task 4: Shared components rebuild

**Files:**
- Modify: `frontend/components/MetricCard.tsx`
- Modify: `frontend/components/OrderTable.tsx`
- Modify: `frontend/components/SeverityBadge.tsx`
- Modify: `frontend/components/Timeline.tsx`
- Modify: `frontend/components/ScanBanner.tsx`
- Test: extend `frontend/tests/timeline.test.tsx`

**Interfaces:**
- Consumes: Task 1 tokens.
- Produces: same props as before, light styling, no glass.

- [ ] **Step 1: Write the failing test**

```tsx
// add to frontend/tests/timeline.test.tsx
test("timeline uses light card", () => {
  const { container } = render(<Timeline items={[{at:"now",kind:"DISPATCHED",label:"Dispatched",detail:"ok"}]} />);
  expect(container.innerHTML).not.toMatch(/15, 23, 42/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/timeline.test.tsx`
Expected: FAIL (old rgba(15,23,42) background present).

- [ ] **Step 3: Write minimal implementation**

MetricCard: white, 1px hairline, 12px radius, uppercase caption, 28px ink value, inline SVG sparkline prop `points?: number[]`. OrderTable: white wrapper, thead soft bg muted uppercase, rows hairline dividers, status badge-pill with pastel dot span, INR ink. SeverityBadge: badge-pill + dot color map CRITICAL #ef4444 HIGH #fb923c MEDIUM #8b5cf6 LOW #34d399. Timeline: vertical hairline line, dots pastel by kind (DISPATCHED emerald, RETURN orange, REFUND red, else violet), cards white hairline. ScanBanner: white card + left border status color, ink text, role status/alert preserved.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all 7 existing suites + new).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/MetricCard.tsx frontend/components/OrderTable.tsx frontend/components/SeverityBadge.tsx frontend/components/Timeline.tsx frontend/components/ScanBanner.tsx
git commit -m "feat: rebuild shared components in Cal.com system"
```

### Task 5: App routes restyle

**Files:**
- Modify: `frontend/app/login/page.tsx`
- Modify: `frontend/app/dashboard/page.tsx`
- Modify: `frontend/app/orders/page.tsx`
- Modify: `frontend/app/orders/[id]/page.tsx`
- Modify: `frontend/app/scan/dispatch/page.tsx`
- Modify: `frontend/app/scan/return/page.tsx`
- Modify: `frontend/app/exceptions/page.tsx`
- Modify: `frontend/app/settings/tally/page.tsx`
- Modify: `frontend/app/parcels/[barcode]/page.tsx`

**Interfaces:**
- Consumes: Tasks 1-4 components, lib/api unchanged.
- Produces: same data flow, light layout with NavPillGroup on each page.

- [ ] **Step 1: Write the failing test**

Reuse `frontend/tests/dashboard.test.tsx`: assert no `glass-card` class in dashboard empty state. Run to confirm FAIL before edits.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/dashboard.test.tsx`
Expected: FAIL (glass-card present).

- [ ] **Step 3: Write minimal implementation**

Login: centered white card 440px hairline 12px, black CTA, demo fill secondary small. Dashboard: container, display-md h1, NavPillGroup active /dashboard, KPI grids 4-up white MetricCards with count-up, export primary. Orders/scan/exceptions/tally/parcels: replace inline dark colors (#0f172a, text-muted vars) with ink/body/muted tokens, wrap tables/forms in white hairline cards, add NavPillGroup with correct active href, keep all api() calls and handlers byte-identical.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/login/page.tsx frontend/app/dashboard/page.tsx frontend/app/orders/page.tsx "frontend/app/orders/[id]/page.tsx" frontend/app/scan/dispatch/page.tsx frontend/app/scan/return/page.tsx frontend/app/exceptions/page.tsx frontend/app/settings/tally/page.tsx "frontend/app/parcels/[barcode]/page.tsx"
git commit -m "feat: restyle app routes to Cal.com light system"
```

### Task 6: Verification + responsive + motion polish

**Files:**
- Modify: `frontend/app/globals.css` (responsive breakpoints only)
- Test: existing suites.

**Interfaces:**
- Consumes: all tasks.
- Produces: 768/1024 breakpoints, hamburger sheet visible, grids collapse.

- [ ] **Step 1: Add responsive CSS**

```css
@media (max-width: 1024px){.grid-3{grid-template-columns:repeat(2,1fr);}.grid-4{grid-template-columns:repeat(2,1fr);}}
@media (max-width: 768px){.hero-grid{grid-template-columns:1fr !important;}.display-xl{font-size:32px !important;}.grid-3,.grid-4{grid-template-columns:1fr;}.topnav-links{display:none;}}
```

- [ ] **Step 2: Run full verification**

Run: `npm test`
Expected: PASS all suites.
Run: `npm run build`
Expected: BUILD success, no type errors.

- [ ] **Step 3: Manual check**

Check 1440/800/390 widths: topnav collapses, hero stacks, pricing 4→2→1, footer 4→1, only dark surfaces are footer + featured pricing.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat: add responsive breakpoints and motion polish"
```
