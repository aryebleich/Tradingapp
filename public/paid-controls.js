// Display only. The API remains responsible for checking plan access.
export const requiredPlan = Object.freeze({
  'Sub-hourly scanners': 'Pro',
  'More scanners': 'Pro',
  'Brokerage automation': 'Pro',
  'Saved scanner filters and alerts': 'Pro',
  'Automatic dividend reinvestment': 'Pro',
  'Linking your bank card': 'Pro',
  '5-year valuation history': 'Pro',
  'AI company summary': 'Pro',
  '5-year financial statements': 'Pro',
  'Volume profile': 'Pro',
  'All diversification suggestions': 'Pro',
  'AI morning picks': 'Pro',
  'AI morning picks with real money': 'Elite',
  'AI intraday trading': 'Elite',
  'Dividend safety scores': 'Pro',
  'Live statistical arbitrage refresh': 'Pro',
  'Full premarket and after-hours lists': 'Pro',
});

export function unlockLabel(feature) {
  if (!Object.hasOwn(requiredPlan, feature)) throw new Error('Unknown paid control: ' + feature);
  return 'Unlock with ' + requiredPlan[feature];
}

export function accountPlanSuffix(account, allowed) {
  return account !== 'paper' && !allowed ? ' · ' + unlockLabel('Brokerage automation') : '';
}
