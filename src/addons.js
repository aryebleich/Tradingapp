// Add-ons each user can switch off in Settings: live property values, cap tables, K-1 forms, the
// weekly AI brief and the tax-saving autopilot. All start switched on. Also the phone line language.
import express from 'express';
import { requireUser } from './auth.js';
import { getSetting, setSetting } from './settings.js';

export const ADDONS = {
  liveProperty: 'Live home values and rent estimates',
  capTable: 'Cap-table tracker for private companies',
  k1: 'K-1 tax forms from private funds',
  brief: 'Weekly AI money brief',
  taxPilot: 'Tax-saving autopilot',
};
export async function addonsFor(userId) {
  const s = await getSetting(userId, 'addons', null) || {};
  return Object.fromEntries(Object.keys(ADDONS).map(k => [k, s[k] !== false]));
}
export const addonOn = async (userId, k) => (await addonsFor(userId))[k];
export const requireAddon = k => async (req, res, next) => {
  if (await addonOn(req.user.id, k)) return next();
  res.status(403).json({ error: `${ADDONS[k]} is switched off in Settings → Add-ons`, addonOff: k });
};

export const addonsRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', async (req, res) => res.json({ addons: await addonsFor(req.user.id), labels: ADDONS, phoneLang: await getSetting(req.user.id, 'phoneLang', 'en') }));
  r.put('/', async (req, res) => {
    const cur = await addonsFor(req.user.id), b = req.body || {};
    const next = Object.fromEntries(Object.keys(ADDONS).map(k => [k, k in (b.addons || {}) ? !!b.addons[k] : cur[k]]));
    await setSetting(req.user.id, 'addons', next);
    if (['en', 'yi'].includes(b.phoneLang)) await setSetting(req.user.id, 'phoneLang', b.phoneLang);
    res.json({ addons: next, phoneLang: await getSetting(req.user.id, 'phoneLang', 'en') });
  });
  return r;
})();
