# Brightolio design system: layout v2

The layout redesign is a thin layer on top of the existing design system, not a new one. Colours, fonts, radii, shadows and every component (cards, buttons, pills, segmented controls, tables, dialogs, the order ticket) are the ones already in `public/theme.css` (app) and `public/site.css` (public pages). Layout v2 adds the spacing and type scales, page widths, breakpoints and the rules below. They live in `public/layout.css` and `public/layout.js`, and apply only under `<html class="lv2">`, which is part of every page.

Rules for anyone adding a page:
- Use these tokens and the existing components.
- Don't write one-off styles. If a page needs something new, add it here first, as a rule.

## Tokens

### Spacing (4 px base)

| Token | Value | Use |
|---|---|---|
| `--s1` | 4px | Icon to label |
| `--s2` | 8px | Between a label and its field; inside pills |
| `--s3` | 12px | Between fields in a row; between stat tiles |
| `--s4` | 16px | Between cards; page gutter on phones |
| `--s5` | 24px | Page gutter on tablets and desktop |
| `--s6` | 32px | Footer gutter on desktop |
| `--s7` | 48px | Bottom of the page |
| `--s8` | 64px | Space kept clear above the phone tab bar |

Cards keep their existing padding from theme.css (18px). Component padding is not overridden, because some components (the page guides, for example) rely on their own.

### Type

| Token | Size | Use |
|---|---|---|
| `--t-2xl` | 28px | The page's one `h1` (the existing size, kept) |
| `--t-xl` | 22px | Reserved for the page `h1` on phones in a later pass (see below) |
| `--t-lg` | 18px | Reserved for section titles in long pages |
| `--t-md` | 15px | Body text (unchanged) |
| `--t-sm` | 13.5px | Public-site footer |
| `--t-xs` | 12px | Footer disclosures in the app. **12px is the minimum for any disclosure**; the tests enforce it. |

Font family is unchanged: Inter, with Rubik and Noto Sans Hebrew for Yiddish. Figures keep `tabular-nums`.

### Colour roles (unchanged)

| Role | Token | Notes |
|---|---|---|
| Page background | `--bg`, `--bg2` | |
| Surface | `--card` | |
| Text | `--tx` | |
| Secondary text | `--mu` | 5.0:1 on `--bg` in light mode. Disclosures may use it; it passes AA. |
| Accent and links | `--ac`, `--grad` | |
| Gain / loss | `--gr` / `--rd` | Always paired with a sign or arrow, never colour alone |
| Warning | `--warn` | |
| Focus | `--ac`, as a 2px solid outline | New: an outline, not a box-shadow, so it shows in forced-colours mode |

No colour was changed. The axe contrast failures already in the old layout are listed in AUDIT.md and NEEDS_REVIEW.md. The layout layer adds none (gate 6).

## Breakpoints and grid

| Name | Width | Layout |
|---|---|---|
| Phone | ≤ 640px | One column. Stat tiles 2 across. Form labels full width. Bottom tab bar (existing). 16px gutter. |
| Tablet | 641–1100px | One column for trading (`.cols` already stacks at 1100). Cards in an auto-fit grid. 24px gutter. |
| Desktop | > 1100px | Sidebar (existing) plus content up to 1280px wide (`--w-page`), centred. 24px gutter. |

The widths tested are 390, 768, 1280 and 1440px.

Grid: the existing `.grid` (auto-fit, minimum 300px) and `.cols` (content plus a 360px side column) are kept. Gaps are `--s4`. On phones `.grid` is always one column.

## Vertical rhythm is frozen

The new layout keeps every vertical distance of the old one: headings, margins between fields and rows, gutters and line lengths. A first version enlarged headings and gutters, and the comparison showed disclosures moving 54 to 70px down at 1280px, three of them below the fold. Rule 1 forbids that. So vertical spacing changes only where it can't move a disclosure: below the last disclosure, or inside phone stacks the tests cover.

## Component rules

- **One `h1` per view, first in the view.** Sections use `h2`. The tests report pages without exactly one visible `h1`.
- **One primary action per view.** It uses the filled button. Other buttons on the view use `ghost` or `small`.
- **Targets.** On phones, full-size buttons in forms, rows, cards and dialogs are at least 44px tall. Chips and segmented buttons are at least 36px. Inline help ("?") and icon buttons keep their size, which is allowed for inline targets under WCAG 2.5.8.
- **Fields on phones** use 16px text, so iOS doesn't zoom in on focus.
- **Tables** scroll inside their own box, never the page. `layout.js` wraps any unwrapped table in `.tablewrap`: a keyboard-focusable region named after its card heading, with edge shadows when more columns are hidden. Tables already built to stack into cards (`table.stack`) keep that behaviour. Header cells stay visible while the table scrolls.
- **Loading.** Where the shape of the content is known, show a skeleton, not a spinner or bare text. Page loads already show the skeleton outline (`.skel`). A section that says "Loading…" becomes two skeleton lines (`.lv2-load`). The words stay in the page for screen readers (`role="status"`), and the animation stops under reduced motion.
- **Empty states** say what is empty and give the next step as a link on the same line (for example "No positions" → "Go to Trade"), so nothing below moves. The copy added is listed in COPY_CHANGES.md.
- **Errors.** A message in `.err` shows as a tinted box with a red edge once it has text. It stays next to the control it belongs to.
- **Disclosures** are never collapsed, hidden or moved further down than they were. Signed-in pages now show the footer disclosures under every page; the old layout hid them while signed in.
- **Trading, order, payment, funding and sign-in pages.** Only the wrapping layout and spacing change. `layout.js` never touches forms, dialogs, the order ticket (`#tk`, `.ticket`) or the buy bar (`#tradeBar`). The order of controls and confirmation steps is unchanged.

## Page titles, wording, badges and empty states

- **Page titles.** Every app screen sets the browser title to "<menu or tab name> · Brightolio" (pageTitle in public/app.js, WCAG 2.4.2). A screen not in the menu uses PAGE_TITLES or the text of its `h1`.
- **One word for practice money.** Use "Paper" on pills, switches and account names, and "practice money" in sentences. Do not write "test money" for the paper account. That phrase stays only for a live brokerage connection running on its sandbox ("Live account, test money").
- **Badges** (`.save`, `.og-tag`, pills) mix their colour toward `--tx`, so they keep 4.5:1 contrast in light and dark themes. Never use the bare accent or gain colour as text on its own tint.
- **Empty states** use `.empty`: the bold fact ("No orders yet."), then the next step as a link or a `data-go` jump on the same line. Never leave a bare "None" or an empty table body.
- **Sign-up and sign-in** have an `h1`. Sign-up sits beside a short factual panel (`.auth-side`) on desktop and under it on phones. The panel says only what the plan data and the risk pages already say.

## Merged pages and tabs

When pages do one job together, the menu shows one entry and the page shows a tab strip (`nav.hubtabs`) right under its title, above the page guide. The pages are listed in `HUBS` in `public/app.js`. Each tab stays its own page at `#/<entry>/<tab>`, and its old address redirects there. Tabs are chips: 36px tall, the current one filled (`--tx`) and marked `aria-current="page"`. On phones the strip scrolls sideways instead of wrapping, so the first card does not move down. A page's own inner tabs (`.seg`, `.chips`) stay below it. Tab labels are the pages' own names.

**Related.** A page that works with other features ends with one "Related" row (`nav.related`): links only, never buttons that act. A page that holds one item (a strategy, a Playbook) puts its Related row at the top. That row jumps to the item's own backtest, run settings and sharing (`data-go="#id"` scrolls without changing the address).

## Dashboard home

Home (`routes.dashboard`) is one page for every account type: practice, Alpaca and the other brokerages. Each type supplies the same shape of data (`homeBasic`, `homeAlpaca`). The order is fixed:

1. Title row: "Portfolio", the account pill, the clock and the account switcher.
2. "Action needed", one compact banner, only when there is something to do.
3. The welcome card, only for a brand-new practice account.
4. The chart, with time ranges and the statement row.
5. One row of key numbers (`.dash-kpis`): 5 across on desktop (6 with "Since you last looked"), 3 on a tablet, 2 on a phone, every tile the same height.
6. The main grid (`.dash-main`, about 2/3 and 1/3, one column under 768px). Left: Positions (count in the header, sorted by value, sortable columns), then Recent orders. Right: the quick ticket, My day, Why my P/L moved, and for Alpaca, Balances & margin.
7. Get started (collapsible; Hide is saved to the account), the page guide slot, the other accounts (`#acctBoxes`) and, for practice money, the Paper account card with Reset.

Cards that load later go into fixed slots holding a skeleton of their usual height, so nothing below them moves. Every card uses the theme's 18px padding and `--r`, and every card heading uses `--t-lg`.

## Confirm dialogs with a table

A confirm that lists what will change (Equalize positions) follows one pattern:
- A one-line summary goes above the table.
- Tick boxes sit in the first column, with Select all / none in the header and "X of Y included" above.
- Numbers are right-aligned and use `tabular-nums`. Rows left out are greyed and say "Not changed".
- A sticky footer holds the totals and the buttons. The confirm button says exactly what it does ("Place 3 trades") and is disabled while a recount is pending or the choice is not valid.
- The password and "I understand" steps of `secureConfirm` are never changed. The dialog only adds content through `onOpen`.
- On phones the dialog uses 16px padding and the buttons stretch full width.

## Mobile navigation pattern

This is the existing pattern, which is kept:
- A bottom tab bar (Portfolio, Trade, Orders, Positions, Menu) in thumb reach.
- The full menu in a drawer from the left, opened by Menu or ☰.
- The page's own primary action stays in the page flow; the order ticket's sticky Buy bar is unchanged.

Layout v2 keeps the last disclosures clear of the tab bar (bottom padding plus the safe-area inset).

## Research, AI and growth pages (2026-11-22)

- **Page frame:** `pagehead` (h1 plus a one-line plain-words purpose), then an account picker card where the page is about one account, then cards. Loading uses the shared `.skel`; nothing loaded yet uses `.empty` with the next step as a link.
- **Numbers:** `.stats` with `.stat` tiles (label, value, an optional `small` line). Signed values use `.pos` and `.neg`; tables use `table.slim` inside `.tablewrap` (focusable, with an `aria-label` when it can scroll).
- **Charts:** bar charts are HTML (`.hbars`, `.mbars`); line charts are SVG with a legend (`svg.lines`, `.legend`). Every chart has `role="img"` and an `aria-label` that reads the numbers. There are no colour-only signals: each bar or line also has a label or a legend entry.
- **Locks:** a paid part shows `.empty.lock` with what it unlocks and "Unlock with <plan>", which opens the upgrade window. The free part always shows real data (the sample before the paywall), never a blurred or fake preview.
- **Company card before a buy:** `.qcard` above the confirm. It loads in the background, never blocks the order, and can be hidden per stock.
- **AI and automation pages:** the not-advice line is at the end of the page, the record shows losses, paper is the default, and the "Real money" fieldset asks for the password before it turns on.
- **Related links:** every new page ends with `H.related([...])` to the tools that go with it, and each stock-page section links to its matching tools.

## Page help (the "i")

- Every page title ends with the round "i" (`.pinfo`), before the gear (`.pgear`) when there is one. Never draw a guide or beginner card into the page; put the text in `G[route]` (pages/guides.js) or a `<template data-info>` on the page.
- The panel is `dialog.infodlg`: a right-hand drawer at desktop widths (left in RTL), a bottom sheet under 600px. Warnings, legal and risk text stay on the page.
- New pages need guide text: test/page-help.test.js fails for a menu page without one.

## Always on

The layout layer is part of every page (`<html class="lv2">`, `layout.css`, `layout.js`). There is no flag. It is checked on every merge by `test/layout/gate.sh` against the golden baseline (`test/golden/`).
