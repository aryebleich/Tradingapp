// Maintenance mode: trading is paused while the database moves (or for any other maintenance).
// New orders are refused with a clear message, and the scheduler, bots, Playbooks, equalize and the
// pair engines do not run. It is on when MAINTENANCE=1 is in the environment (survives restarts on
// the VM), or when it was switched on at run time (Admin → Database, or POST /internal/maintenance by
// the migration workflow). The run-time switch is kept in memory and, when the database answers, in
// site_settings, so it holds even while the database refuses reads.
import { siteGet, siteSet } from './site.js';

let mem = null; // { on, reason, at } set at run time on this server
export const MAINTENANCE_MESSAGE = 'Brightolio is under maintenance: trading is paused for safety. Your data is safe; please try again shortly.';
export function maintenance() {
  if (process.env.MAINTENANCE === '1') return { on: true, reason: 'MAINTENANCE=1 in the settings', at: null, source: 'env' };
  if (mem) return { ...mem, source: 'switch' };
  const s = siteGet('maintenance', null);
  return s?.on ? { ...s, source: 'saved' } : { on: false };
}
export const inMaintenance = () => maintenance().on === true;
export async function setMaintenance(on, reason = '') {
  mem = on ? { on: true, reason: String(reason || 'maintenance').slice(0, 200), at: Date.now() } : { on: false, at: Date.now() };
  await siteSet('maintenance', mem).catch(() => {}); // the database may be the reason: memory is enough
  if (!on) mem = null;
  return maintenance();
}
// Thrown by placeOrder while paused: a 503 the pages show as is.
export const maintenanceError = () => Object.assign(new Error(MAINTENANCE_MESSAGE), { status: 503, maintenance: true });
