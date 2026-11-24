# Copy changes: layout v2

The brief allowed copy changes only where a label blocks the layout. **No existing text was changed or removed.** Every disclosure, label, validation message, figure and confirmation text is identical in both layouts; `test/layout/compare.mjs` checks this on every page at every width.

The new layout adds the text below. Each item appears only where the layout adds a next step or an accessible name.

## Visible text added

| Where | Added | Why |
|---|---|---|
| Empty "No positions…" messages (Portfolio, Positions, account cards) | Link **"Go to Trade"** under the message | An empty state gets a clear next step (Phase 4). Not shown on the Trade page itself. |
| Empty "No orders…" messages (Orders) | Link **"Go to Trade"** | Same |
| Empty "No runs…" messages (Backtest history) | Link **"Run a backtest"** | Same |
| Empty "No signals…" messages (Signals) | Link **"Open Signals"** | Same; not shown on the Signals page itself |

The empty-state links are added by `public/layout.js`. They never appear inside forms, dialogs, the order ticket or the Buy bar.

## Accessible names added (not visible)

| Where | Added | Why |
|---|---|---|
| Logo link (app header, public site header and footer) | `aria-label="Brightolio home"` | The link had no accessible name on 108 pages (axe `link-name`, WCAG 2.4.4 / 4.1.2) |
| Fields inside ledger and business tables (Debit, Credit, Account…) | `aria-label` taken from the column name already shown (`data-label`) | Fields had no label (axe `label`, `select-name`, WCAG 1.3.1 / 4.1.2) |
| Table scroll boxes | `role="region"` and `aria-label` set to the card's existing heading | A scrollable region must be named and reachable by keyboard |
| "Loading…" lines | `role="status"` (the words themselves are unchanged and still read out) | The skeleton replaces the visible words; screen readers still hear them |

## Text not changed

- All legal pages (Terms, Privacy, Risk Disclosure, Security, Insurance, Status, Contact).
- The app footer: "Trading involves risk of loss. Backtests and projections are hypothetical…". It is now *shown* on signed-in pages, where the old layout hid it, but its words are unchanged.
- All trading, order, payment, funding, margin and sign-in text, including the confirmation dialogs (Review order, Review options order, Confirm transfer, Close ALL positions?, Cancel all open orders?, Exercise option?, Submit application?, Remove bank account?, Modify order).
