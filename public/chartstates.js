// Equity chart colors follow what the money is doing, judged against the starting value (base) and
// the highest value so far (peak):
//   high     above the start and at a new high        → green   (a gain still growing)
//   pullback above the start but below the peak       → blue    (a gain, giving some back)
//   recover  below the start and up on the day        → amber   (a loss, recovering)
//   loss     below the start and down (or flat)       → red     (a loss, getting worse)
export const CHART_STATES = {
  high: { color: '#10b981', label: 'New high' },
  pullback: { color: '#3b82f6', label: 'Gain, below its high' },
  recover: { color: '#f59e0b', label: 'Loss, recovering' },
  loss: { color: '#ef4444', label: 'Loss, falling' },
};
export function chartStates(series, base = series[0]) {
  let peak = series[0];
  return series.map((v, i) => {
    peak = Math.max(peak, v);
    if (i === 0) return v >= base ? 'high' : 'loss';
    return v >= base ? (v >= peak ? 'high' : 'pullback') : (v > series[i - 1] ? 'recover' : 'loss');
  });
}
