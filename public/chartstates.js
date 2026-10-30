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

// "Colorful" (Settings → Chart colors): seven states, judged against the start, the peak so far and
// the last week's direction. The chart blends smoothly from one color to the next.
//   peak       at a new high                               deep emerald
//   near       a gain, within 3% of its high               teal
//   pullback   a gain, 3-10% below its high                blue
//   deep       a gain, more than 10% below its high        violet
//   rebound    below the start, higher than a week ago     amber
//   slide      below the start, lower than a week ago      orange
//   deepLoss   more than 10% below the start               rose
export const RICH_STATES = {
  peak: { color: '#059669', label: 'New high' },
  near: { color: '#0d9488', label: 'Near its high' },
  pullback: { color: '#2563eb', label: 'Gain, pulling back' },
  deep: { color: '#7c3aed', label: 'Gain, well below its high' },
  rebound: { color: '#d97706', label: 'Loss, rebounding' },
  slide: { color: '#ea580c', label: 'Loss, sliding' },
  deepLoss: { color: '#e11d48', label: 'Deep loss' },
};
export function richStates(series, base = series[0]) {
  let peak = series[0];
  return series.map((v, i) => {
    peak = Math.max(peak, v);
    const fromPeak = peak ? (v / peak - 1) * 100 : 0, fromBase = base ? (v / base - 1) * 100 : 0, week = series[Math.max(0, i - 5)];
    if (v >= base) return v >= peak ? 'peak' : fromPeak > -3 ? 'near' : fromPeak > -10 ? 'pullback' : 'deep';
    return fromBase < -10 ? 'deepLoss' : v >= week ? 'rebound' : 'slide';
  });
}
// Each point's color, softened with its neighbours so the line blends from color to color.
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
export function blendedColors(series, base, reach = 3) {
  const raw = richStates(series, base).map(s => rgb(RICH_STATES[s].color));
  return raw.map((_, i) => {
    let w = 0; const acc = [0, 0, 0];
    for (let j = Math.max(0, i - reach); j <= Math.min(raw.length - 1, i + reach); j++) { const k = reach + 1 - Math.abs(i - j); w += k; for (let c = 0; c < 3; c++) acc[c] += raw[j][c] * k; }
    return acc.map(c => Math.round(c / w));
  });
}
