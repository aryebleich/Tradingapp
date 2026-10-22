// Broker API (HTTP Basic auth with the platform's broker key): customer accounts, KYC,
// ACH relationships and transfers. Trading for these accounts goes through trading.js.
import { URLS, request } from './http.js';

export const brokerEnabled = () => !!(process.env.BROKER_API_KEY && process.env.BROKER_API_SECRET);
const auth = () => ({ basic: [process.env.BROKER_API_KEY, process.env.BROKER_API_SECRET] });
const call = (path, opts = {}) => {
  if (!brokerEnabled()) throw Object.assign(new Error('Brokerage accounts are not configured on this server (BROKER_API_KEY / BROKER_API_SECRET).'), { status: 503 });
  return request(URLS.broker(), '/v1' + path, { ...opts, auth: auth() });
};
export const brokerAuth = auth;

export const createAccount = body => call('/accounts', { method: 'POST', body });
export const getAccount = id => call(`/accounts/${encodeURIComponent(id)}`);
export const updateAccount = (id, body) => call(`/accounts/${encodeURIComponent(id)}`, { method: 'PATCH', body });
export const listAccounts = query => call('/accounts', { query });

export const listAch = id => call(`/accounts/${encodeURIComponent(id)}/ach_relationships`);
export const createAch = (id, body) => call(`/accounts/${encodeURIComponent(id)}/ach_relationships`, { method: 'POST', body });
export const deleteAch = (id, achId) => call(`/accounts/${encodeURIComponent(id)}/ach_relationships/${encodeURIComponent(achId)}`, { method: 'DELETE' });

export const listTransfers = (id, query) => call(`/accounts/${encodeURIComponent(id)}/transfers`, { query });
export const createTransfer = (id, body) => call(`/accounts/${encodeURIComponent(id)}/transfers`, { method: 'POST', body });
export const cancelTransfer = (id, tId) => call(`/accounts/${encodeURIComponent(id)}/transfers/${encodeURIComponent(tId)}`, { method: 'DELETE' });

// Maps the onboarding form to the Broker API account schema. SSN and other identity data are
// forwarded to Alpaca only; this app never stores them.
export function buildAccountRequest(f, ip, now = new Date()) {
  const req = (v, name) => { if (v === undefined || v === null || String(v).trim() === '') throw Object.assign(new Error(`${name} is required`), { status: 400 }); return String(v).trim(); };
  const ssn = req(f.ssn, 'Social Security number').replace(/\D/g, '');
  if (!/^\d{9}$/.test(ssn)) throw Object.assign(new Error('Social Security number must have 9 digits'), { status: 400 });
  const dob = req(f.dateOfBirth, 'Date of birth');
  const age = (now - new Date(dob)) / (365.25 * 86400e3);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || !(age >= 18 && age < 120)) throw Object.assign(new Error('You must be at least 18 years old'), { status: 400 });
  const signedAt = now.toISOString();
  const agreements = ['customer_agreement', 'account_agreement', ...(f.margin ? ['margin_agreement'] : []), ...(f.crypto ? ['crypto_agreement'] : []), ...(f.options ? ['options_agreement'] : [])];
  if (!f.agreeCustomer) throw Object.assign(new Error('You must accept the Alpaca Customer Agreement'), { status: 400 });
  return {
    contact: {
      email_address: req(f.email, 'Email'),
      phone_number: req(f.phone, 'Phone'),
      street_address: [req(f.street, 'Street address')],
      unit: f.unit || undefined,
      city: req(f.city, 'City'),
      state: req(f.state, 'State'),
      postal_code: req(f.postalCode, 'ZIP code'),
      country: 'USA',
    },
    identity: {
      given_name: req(f.givenName, 'First name'),
      middle_name: f.middleName || undefined,
      family_name: req(f.familyName, 'Last name'),
      date_of_birth: dob,
      tax_id: `${ssn.slice(0, 3)}-${ssn.slice(3, 5)}-${ssn.slice(5)}`,
      tax_id_type: 'USA_SSN',
      country_of_citizenship: req(f.citizenship, 'Citizenship'),
      country_of_birth: f.countryOfBirth || f.citizenship,
      country_of_tax_residence: 'USA',
      funding_source: [f.fundingSource || 'employment_income'],
    },
    disclosures: {
      is_control_person: !!f.isControlPerson,
      is_affiliated_exchange_or_finra: !!f.isAffiliated,
      is_politically_exposed: !!f.isPoliticallyExposed,
      immediate_family_exposed: !!f.familyExposed,
      employment_status: f.employmentStatus || undefined,
      employer_name: f.employerName || undefined,
      employment_position: f.employmentPosition || undefined,
    },
    agreements: agreements.map(agreement => ({ agreement, signed_at: signedAt, ip_address: ip || '127.0.0.1' })),
    enabled_assets: ['us_equity', ...(f.crypto ? ['crypto'] : []), ...(f.options ? ['us_option'] : [])],
  };
}

// Status lifecycle shown to users: the KYC journey from submission to a tradable account.
export const KYC_STEPS = ['SUBMITTED', 'APPROVED', 'ACTIVE'];
export function kycStep(status) {
  if (['ACTIVE'].includes(status)) return 3;
  if (['APPROVED'].includes(status)) return 2;
  if (['SUBMITTED', 'APPROVAL_PENDING', 'AML_REVIEW', 'ONBOARDING', 'RESUBMITTED', 'KYC_SUBMITTED', 'REAPPROVAL_PENDING'].includes(status)) return 1;
  return 0; // ACTION_REQUIRED, REJECTED, SUBMISSION_FAILED, DISABLED, ...
}
