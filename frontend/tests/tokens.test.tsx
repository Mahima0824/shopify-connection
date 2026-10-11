import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { globSync } from "fs";
import { expect, test } from "vitest";
const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(here, "../src/styles/globals.css"), "utf8");
const read = (p: string) => fs.readFileSync(path.join(here, p), "utf8");

test("the legacy teal palette is fully retired", () => {
  // --canvas / --ink / --accent are gone. These three hexes must not come back.
  expect(css).not.toMatch(/#0f7665|#115e59/i);
});

test("primary stays sky, not the DESIGN.md black", () => {
  // DESIGN.md mandates a #000000 pill button and bans blue outright, but the sky
  // accent was an explicit product decision, so primary is deliberately sky and
  // the doc's black-pill rule is not applied. Guard both halves of that.
  expect(css).toMatch(/--dm-primary:\s*oklch\(0\.5\s+0\.134\s+242\.749\)/i);
  expect(css).not.toMatch(/--dm-primary:\s*oklch\(0\s+0\s+0\)/i);
});

test("DESIGN.md palette tokens are declared", () => {
  expect(css).toMatch(/--dm-background:\s*oklch\(0\.9864\s+0\.0079\s+106\.54\)/i); // canvas-cream
  expect(css).toMatch(/--dm-foreground:\s*oklch\(0\s+0\s+0\)/i);                 // ink
  expect(css).toMatch(/--dm-border:\s*oklch\(0\.9197\s+0\.004\s+286\.32\)/i);   // hairline-light
  expect(css).toMatch(/--dm-accent:\s*oklch\(0\.9382\s+0\.0789\s+155\.19\)/i);  // aloe-10
});

test("radius ladder matches the measured reference", () => {
  // 4 / 6 / 8 / 10 from the captured page, with 10px dominant on cards and
  // 6px on buttons and inputs. Nothing larger than 10px was measured, so the
  // top of the ladder clamps there rather than inventing a bigger corner.
  expect(css).toMatch(/--radius-xs:\s*4px/i);
  expect(css).toMatch(/--radius-sm:\s*6px/i);
  expect(css).toMatch(/--radius-md:\s*8px/i);
  expect(css).toMatch(/--radius-lg:\s*10px/i);
  expect(css).toMatch(/--radius-xl:\s*10px/i);
  expect(css).toMatch(/--radius-pill:\s*9999px/i);
  expect(css).not.toMatch(/--radius-lg:\s*var\(--sc-radius\)/i);
});

test("Poppins is the family for both the body and heading slots", () => {
  // The measured reference uses Poppins for every role; there is no separate
  // display cut to fall back to.
  expect(css).toMatch(/--font-sans:\s*'Poppins'/i);
  expect(css).toMatch(/--font-heading:\s*'Poppins'/i);
  expect(css).toMatch(/@fontsource\/poppins\/400\.css/i);
});

test("section rhythm utility matches the measured 100px sections", () => {
  expect(css).toMatch(/@utility\s+py-section\s*\{\s*padding-block:\s*100px/i);
});

test("one container width governs nav, page body and footer", () => {
  // Every page used to hardcode its own max-w, which is why Orders (1400px),
  // OrderDetail (1000px) and the 7xl pages drifted out of line with the nav.
  // They now all resolve to .page-shell, backed by one --shell-max variable.
  expect(css).toMatch(/@utility\s+page-shell\s*\{/i);
  expect(css).toMatch(/--shell-max:\s*1280px/i);

  // Guard against a page reintroducing a hardcoded page-level container.
  const files = globSync(path.join(here, "../src/**/*.tsx"));
  const offenders: string[] = [];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    src.split("\n").forEach((line, i) => {
      // Skip component-local max-w (modals, dialogs, avatar stacks); only a
      // full-bleed page container paired with mx-auto is the offender.
      if (
        /max-w-\[(1280|1400)px\]|max-w-(7xl|5xl)/.test(line) &&
        /\bmx-auto\b/.test(line)
      ) {
        offenders.push(`${path.relative(here, file)}:${i + 1}`);
      }
    });
  }
  expect(offenders).toEqual([]);
});

test("no native <select> remains; every picker uses the shadcn Select", () => {
  // Native selects render with the OS chrome, which clashed with the themed
  // inputs beside them (and could not match their height). Radix Select gives
  // an accessible combobox and one consistent look.
  const files = globSync(path.join(here, "../src/**/*.tsx"));
  const offenders: string[] = [];
  for (const file of files) {
    fs.readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        // Match <select ...> but ignore mentions inside comments.
        if (/<select[\s>]/.test(line) && !/^\s*(\/\/|\/\*|\*)/.test(line)) {
          offenders.push(`${path.relative(here, file)}:${i + 1}`);
        }
      });
  }
  expect(offenders).toEqual([]);
});

test("no native date/month input remains; every date field uses the Calendar", () => {
  // <input type="date"> and type="month" render with the OS chrome and could
  // not be styled to match the rest of the form. All of them are now
  // DatePicker / MonthPicker, built on the shadcn Calendar.
  const files = globSync(path.join(here, "../src/**/*.tsx"));
  const offenders: string[] = [];
  for (const file of files) {
    fs.readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (
          /type="(date|month|datetime-local)"/.test(line) &&
          !/^\s*(\/\/|\/\*|\*)/.test(line)
        ) {
          offenders.push(`${path.relative(here, file)}:${i + 1}`);
        }
      });
  }
  expect(offenders).toEqual([]);
});

test("no raw <input>/<textarea> bypasses the themed primitives", () => {
  // A bare <input className="...border-slate-300..."> renders with unthemed
  // chrome beside themed fields. Everything goes through Input/Textarea.
  const files = globSync(path.join(here, "../src/**/*.tsx"));
  const offenders: string[] = [];
  for (const file of files) {
    // The shadcn ui/ layer is where the primitive itself is defined, so a raw
    // <input> there is the source, not a bypass.
    if (file.replace(/\\/g, "/").includes("/components/ui/")) continue;
    const src = fs.readFileSync(file, "utf8");
    // Read in overlapping windows so a multi-line <input .../> is judged as a
    // whole; a hidden type="file" picker is triggered by a label and is fine.
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      if (!/<(input|textarea)\b/.test(line)) return;
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;
      const tag = lines.slice(i, i + 8).join("\n");
      if (/type="file"/.test(tag)) return;
      offenders.push(`${path.relative(here, file)}:${i + 1}`);
    });
  }
  expect(offenders).toEqual([]);
});

test("all tables share one set of primitives, not bespoke markup", () => {
  // Every table in the app renders through the Table primitives, so spacing,
  // header weight and row chrome are decided in exactly one place. A raw
  // <table>/<thead>/<tbody> would reintroduce per-page drift.
  const files = globSync(path.join(here, "../src/**/*.tsx"));
  const offenders: string[] = [];
  for (const file of files) {
    // ui/table.tsx is the shadcn primitive itself, and <Table>/<TableHead>
    // are the app components, not raw HTML.
    if (file.replace(/\\/g, "/").includes("/components/ui/")) continue;
    fs.readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        // Case-sensitive: matches raw <table>/<thead>/<tbody> only.
        if (/<(table|thead|tbody)\b/.test(line) && !/^\s*(\/\/|\/\*|\*)/.test(line)) {
          offenders.push(`${path.relative(here, file)}:${i + 1}`);
        }
      });
  }
  expect(offenders).toEqual([]);
});

test("no page overrides the table's own cell padding", () => {
  // primitives.tsx owns px-4 py-3 for cells. Per-call-site padding overrides
  // are what made tables look different from one page to the next.
  const files = globSync(path.join(here, "../src/**/*.tsx"));
  const offenders: string[] = [];
  for (const file of files) {
    if (file.endsWith("primitives.tsx")) continue;
    fs.readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (/<Table(Cell|Head|Row)\b[^>]*className="[^"]*\b(p[xy]-)/.test(line)) {
          offenders.push(`${path.relative(here, file)}:${i + 1}`);
        }
      });
  }
  expect(offenders).toEqual([]);
});

test("Badge tones use the status tokens and render a dash when empty", () => {
  const p = read("../src/components/primitives.tsx");
  expect(p).toMatch(/text-status-success/);
  expect(p).toMatch(/text-status-warning/);
  expect(p).toMatch(/text-status-info/);
  // No raw palette left in the Badge variants.
  expect(p).not.toMatch(/bg-emerald-500\/10|bg-amber-500\/10|bg-blue-500\/10/);
  // An empty value must not render a bare pill.
  expect(p).toMatch(/isEmpty \? "—" : children/);
});

test("Dashboard carries no 700-weight text", () => {
  // The dashboard is a dense data surface; 700 on numbers and micro-labels
  // read as shouting next to Poppins' 500 body weight. Values sit at 600 and
  // micro-labels at 600, which stays legible without dominating the panel.
  const dash = read("../src/pages/Dashboard.tsx");
  expect(dash).not.toMatch(/font-bold|font-extrabold/);
});

test("the dashboard's bespoke stylesheet holds no 700 weights", () => {
  // .shopify-kpi-value / .shopify-big-number carry font-weight: 700. They are
  // currently unreferenced by Dashboard.tsx, but they are exactly the classes a
  // future edit would reach for, so they are pinned to 600 too.
  const cssFile = read("../src/styles/shopify-dashboard.css");
  expect(cssFile).not.toMatch(/font-weight:\s*700/);
});

test("CodRemittance no longer hardcodes raw palette colours", () => {
  expect(read("../src/pages/CodRemittance.tsx")).not.toMatch(
    /\b(rose|emerald|amber|purple|blue)-\d{2,3}\b/
  );
});

test("status tokens are readable on the light canvas", () => {
  // RTO's four data tones moved off the raw Tailwind palette onto these. The
  // measured contrast on #fff is danger 6.29:1, warning 5.02:1, success 5.48:1,
  // info 6.70:1 - all above the 4.5:1 WCAG AA threshold for body text.
  expect(css).toMatch(/--dm-status-danger:\s*#be123c/i);
  expect(css).toMatch(/--dm-status-warning:\s*#b45309/i);
  expect(css).toMatch(/--dm-status-success:\s*#047857/i);
  expect(css).toMatch(/--dm-status-info:\s*#1d4ed8/i);
});

test("RTO no longer hardcodes raw palette colours for its status tones", () => {
  const rto = read("../src/pages/RtoManagement.tsx");
  expect(rto).not.toMatch(/\b(rose|emerald|amber|purple|blue)-\d{2,3}\b/);
});

test("headings render at 500, never 700", () => {
  // The reference measures both heading roles at weight 500. Heavy 700
  // headings read as shouting next to Poppins' 500 body weight, so every
  // <h1>-<h6> must stay at font-medium.
  const files = globSync(path.join(here, "../src/**/*.tsx"));
  const offenders: string[] = [];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    src.split("\n").forEach((line, i) => {
      if (/<h[1-6]\b/.test(line) && /font-bold|font-extrabold/.test(line)) {
        offenders.push(`${path.relative(here, file)}:${i + 1}`);
      }
    });
  }
  expect(offenders).toEqual([]);
});

test("status tokens exist for tones shadcn does not ship", () => {
  expect(css).toMatch(/--dm-success:/i);
  expect(css).toMatch(/--dm-warning:/i);
  expect(css).toMatch(/--dm-neutral:/i);
});

test("canonical token names alias the palette so inline styles follow it", () => {
  // Inline styles still read var(--primary) etc, so those names must point at
  // the DESIGN.md values rather than declaring a second, drifting palette.
  expect(css).toMatch(/--primary:\s*var\(--dm-primary\)/i);
  expect(css).toMatch(/--border:\s*var\(--dm-border\)/i);
  expect(css).toMatch(/--muted-foreground:\s*var\(--dm-muted-foreground\)/i);
});

test("no Clay palette or dark footer remnants", () => {
  expect(css).not.toMatch(/#fffaf0|#ff4d8b|#1a3a3a|#101010/i);
});

test("tabular numerals utility exists", () => {
  // The .tnum helper became Tailwind's `tabular-nums` utility in the JSX.
  expect(read("../src/components/MetricCard.tsx")).toMatch(/tabular-nums/);
});