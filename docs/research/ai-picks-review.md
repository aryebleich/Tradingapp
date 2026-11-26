# RES-02 — Second opinion: AI morning picks & AI portfolios (honesty / disclosures)

**Author:** Grok  
**Date:** 2026-11-26  
**Scope:** AI morning picks (`src/newspicks.js` + related UI), AI long/short portfolios, and the public-facing claims around them.  
**Standard:** Clear, honest, no promised returns, losses visible, paper-first, real money gated.

## Summary judgment

**Overall: good and already stronger than most retail AI-trading products.**  
The core disclosure language is honest, the track record includes losses, paper is the default, and real-money use requires Elite + explicit opt-in + password/step-up. A few small gaps would make it even clearer and reduce any residual “black box” feel.

## What is already solid

1. **Central not-advice line** (`src/newspicks.js`):
   > “AI picks are an experiment, not investment advice. They can and do lose money; the record on this page includes every loss.”

   This is returned as `note: NOT_ADVICE` on the main GET and is used in user notifications. It is unusually direct (most products bury or soften “can lose money”).

2. **Losses are kept and shown**  
   Every day’s picks and results are stored (`newspicks_log`). The `record()` helper computes hit rate, average, worst day, and explicitly notes that past results do not predict future ones. This matches LEGAL_REVIEW L16 intent.

3. **Paper-first, real-money gated**  
   - Default account = paper.  
   - Real account requires `live: true`, Elite plan, identity confirmation (password/email), and step-up guard.  
   - Kill switch, daily loss limit, PDT check, and stop-loss all run on the server.

4. **Sources and reasons per pick**  
   Ranking uses headline tone + pre-market move + volume signal and stores reasons + up to 3 source headlines with titles/URLs. Users can see *why* a symbol was chosen, not just a ticker list.

5. **Day-trade nature is explicit**  
   Positions are closed before the close; PDT rule is checked. This is important honesty for US retail accounts.

## Gaps / recommendations (ordered by impact)

### 1. Make the not-advice note impossible to miss in the UI (High)
The API returns `note: NOT_ADVICE`, but the review should confirm that every surface that shows today’s picks (list, approve card, history, notifications) renders that sentence prominently — above the fold, not only in a footer or tooltip.  
**Suggested fix for Claude/Codex:** Audit the Automate → AI morning picks page and the approve notification copy; ensure the full NOT_ADVICE string (or a one-sentence equivalent) is always visible without scrolling when picks are shown.

### 2. Surface the full track record more aggressively (Medium-High)
`record()` already computes hit rate, losses count, avg/worst/best.  
**Recommendation:** On the main AI picks page, show a permanent summary strip, e.g.  
“Record so far: X days · Y% hit rate · average Z% · worst day W% · includes every loss.”  
Never lead with win rate alone.

### 3. Clarify methodology in one short paragraph (Medium)
Users currently see reasons per pick but not a plain-English description of the ranking rule.  
**Suggested copy (can go under the not-advice note):**  
“How today’s list is made: we look at recent news headlines for a fixed list of large US stocks, score the tone of those headlines, combine that with the pre-market price move (capped), and prefer names with unusual pre-market volume. Only positive scores with at least one headline are kept. This is a simple, rule-based experiment — not a proprietary alpha model and not high-frequency trading.”

### 4. AI long/short portfolios (if separate from morning picks)
LEGAL_REVIEW L16 also names “AI long/short portfolios”. If that feature has its own page, apply the same three rules:  
- Same strength of not-advice language.  
- Full loss-inclusive record.  
- Clear, non-hype description of how the book is built (rebalance frequency, universe, constraints).

### 5. Marketing / homepage (Owner + legal)
LEGAL_REVIEW L16 still has these features marked for confirmation before promotion. Do **not** put “AI morning picks” or win-rate numbers on the public homepage or ads until OWN-04 / legal sign-off. Keep them inside the logged-in product with the existing disclosures.

### 6. Minor technical / product notes
- Universe is a fixed 30 large names — good for honesty (no claim of “whole market”). Consider documenting the universe size on the page.  
- Costs (commissions, slippage, borrow for shorts if any) are not yet folded into the public record note. Adding “before costs” is already present; keep or strengthen it.  
- Automatic mode still sends the not-advice line in the “picks ready” notification — good.

## Verdict for the coding assistants

- No emergency rewrite needed. The foundation is honest.  
- Highest-ROI follow-ups: (1) UI audit so NOT_ADVICE is always visible, (2) permanent track-record strip that includes losses, (3) one-paragraph methodology blurb.  
- Leave any homepage/marketing use to legal (OWN-04).

## Sources examined
- `src/newspicks.js` (full file, 2026-11-26)  
- `LEGAL_REVIEW.md` L16 and related items  
- `AGENTS.md` / product rules (no promised returns, paper default, no dark patterns)

*End of RES-02. Ready for Claude or Codex to implement the UI/copy items above.*
