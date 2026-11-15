// Phone numbers for the SMS and voice module. The server only accepts E.164 (a plus sign, a country
// code and up to 15 digits in all); the Comms Drawer turns what a person types into E.164 first.
export const E164 = /^\+[1-9]\d{7,14}$/;
export const isE164 = s => typeof s === 'string' && E164.test(s);

// What a person types -> E.164, or null. A bare 10-digit number is read as US/Canada (+1) because
// this deployment assumes US traffic (ASSUMPTIONS.md, B-3); anything else needs its country code.
export function toE164(input) {
  const raw = String(input ?? '').trim();
  if (!raw || /[^\d\s().+-]/.test(raw)) return null;
  const digits = raw.replace(/\D/g, '');
  const n = raw.startsWith('+') ? '+' + digits : digits.length === 10 ? '+1' + digits : digits.length === 11 && digits[0] === '1' ? '+' + digits : null;
  return n && isE164(n) ? n : null;
}
// For logs, lists and call history: never the whole number.
export const last4 = n => String(n || '').replace(/\D/g, '').slice(-4);
export const mask = n => (n ? '••••' + last4(n) : '');
