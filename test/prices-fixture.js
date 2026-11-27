// Test-only prices: what a test needs entered in Admin → Prices, through the same setPrice the Admin page
// uses. The app itself has no prices in its code (src/prices.js, DECISIONS.md PR-1).
export const TEST_PRICES = { pro: [14.99, 149], elite: [39.99, 399], ultimate: [89.99, 899] };
export const TEST_PACKS = { c500: 5, c3000: 25, c12000: 80 };
export async function seedPrices({ currency = 'USD' } = {}) {
  const P = await import('../src/prices.js');
  const at = Date.UTC(2026, 0, 1), admin = { email: 'test-owner@example.com' };
  for (const [k, [m, y]] of Object.entries(TEST_PRICES)) {
    await P.setPrice(admin, { item: `plan:${k}:month`, amount: m, currency, effectiveAt: at });
    await P.setPrice(admin, { item: `plan:${k}:year`, amount: y, currency, effectiveAt: at });
  }
  for (const [id, a] of Object.entries(TEST_PACKS)) await P.setPrice(admin, { item: `credits:${id}`, amount: a, currency, effectiveAt: at });
}
