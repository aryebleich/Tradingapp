// Broker API: customer accounts, KYC, documents, ACH relationships and transfers. Trading for
// these accounts goes through trading.js. Every call runs on the server; the browser never sees
// the broker credentials. Auth is HTTP Basic with BROKER_API_KEY:BROKER_API_SECRET, or, when
// BROKER_CLIENT_ID / BROKER_CLIENT_SECRET are set, a bearer token from Alpaca's authx endpoint
// (OAuth client-credentials grant), cached until shortly before it expires.
import { URLS, request } from './http.js';

const env = k => process.env[k];
const oauthCreds = () => (env('BROKER_CLIENT_ID') && env('BROKER_CLIENT_SECRET') ? [env('BROKER_CLIENT_ID'), env('BROKER_CLIENT_SECRET')] : null);
export const brokerEnabled = () => !!((env('BROKER_API_KEY') && env('BROKER_API_SECRET')) || oauthCreds());
// The token service matches the Broker API environment: sandbox credentials get sandbox tokens.
export const tokenUrl = () => env('BROKER_TOKEN_URL') || (/sandbox/.test(env('BROKER_BASE_URL') || 'sandbox') ? 'https://authx.sandbox.alpaca.markets/v1/oauth2/token' : 'https://authx.alpaca.markets/v1/oauth2/token');

let token = null; // { value, until, key }
async function bearer() {
  const [id, secret] = oauthCreds();
  if (token && token.key === id && token.until > Date.now()) return { bearer: token.value };
  let r;
  try {
    r = await fetch(tokenUrl(), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }), signal: AbortSignal.timeout(15000),
    });
  } catch { throw Object.assign(new Error('Could not reach the Alpaca token service. Please try again.'), { status: 503 }); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw Object.assign(new Error(`Alpaca refused the broker credentials (${r.status}): ${d.error_description || d.error || d.message || r.statusText}`), { status: 502 });
  token = { value: d.access_token, until: Date.now() + Math.max(60, (+d.expires_in || 900) - 60) * 1000, key: id };
  return { bearer: token.value };
}
const auth = () => (oauthCreds() ? bearer : { basic: [env('BROKER_API_KEY'), env('BROKER_API_SECRET')] });
const call = (path, opts = {}) => {
  if (!brokerEnabled()) throw Object.assign(new Error('Brokerage accounts are not configured on this server (BROKER_API_KEY / BROKER_API_SECRET).'), { status: 503 });
  return request(URLS.broker(), '/v1' + path, { ...opts, auth: auth() });
};
export const brokerAuth = auth;
// Headers for the long-lived event stream, which does not go through request().
export async function brokerHeaders() {
  let a = auth();
  if (typeof a === 'function') a = await a();
  return a.bearer ? { Authorization: 'Bearer ' + a.bearer } : { Authorization: 'Basic ' + Buffer.from(a.basic.join(':')).toString('base64') };
}

export const createAccount = body => call('/accounts', { method: 'POST', body });
export const getAccount = id => call(`/accounts/${encodeURIComponent(id)}`);
export const updateAccount = (id, body) => call(`/accounts/${encodeURIComponent(id)}`, { method: 'PATCH', body });
export const listAccounts = query => call('/accounts', { query });
export const uploadDocuments = (id, docs) => call(`/accounts/${encodeURIComponent(id)}/documents/upload`, { method: 'POST', body: docs, timeout: 60000 });

export const listAch = id => call(`/accounts/${encodeURIComponent(id)}/ach_relationships`);
export const createAch = (id, body) => call(`/accounts/${encodeURIComponent(id)}/ach_relationships`, { method: 'POST', body });
export const deleteAch = (id, achId) => call(`/accounts/${encodeURIComponent(id)}/ach_relationships/${encodeURIComponent(achId)}`, { method: 'DELETE' });

export const listTransfers = (id, query) => call(`/accounts/${encodeURIComponent(id)}/transfers`, { query });
export const createTransfer = (id, body) => call(`/accounts/${encodeURIComponent(id)}/transfers`, { method: 'POST', body });
export const cancelTransfer = (id, tId) => call(`/accounts/${encodeURIComponent(id)}/transfers/${encodeURIComponent(tId)}`, { method: 'DELETE' });

// Identity documents (passport, driver's license...) sent base64-encoded. Alpaca asks for them
// up front or later when an application is ACTION_REQUIRED.
export const DOC_TYPES = ['passport', 'drivers_license', 'national_id_card', 'state_id'];
const MIME = ['image/jpeg', 'image/png', 'application/pdf'];
export const MAX_DOC_BYTES = 5 * 1024 * 1024;
export function buildDocuments(list) {
  if (list == null || list === '') return [];
  if (!Array.isArray(list)) throw Object.assign(new Error('Documents must be a list'), { status: 400 });
  if (list.length > 4) throw Object.assign(new Error('Upload at most 4 documents'), { status: 400 });
  return list.map(d => {
    const content = String(d?.content || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
    if (!content || !/^[A-Za-z0-9+/]+=*$/.test(content)) throw Object.assign(new Error('A document file is empty or not valid'), { status: 400 });
    if (content.length * 0.75 > MAX_DOC_BYTES) throw Object.assign(new Error('Each document must be under 5 MB'), { status: 400 });
    const mime = String(d.mimeType || d.mime_type || '');
    if (!MIME.includes(mime)) throw Object.assign(new Error('Documents must be JPG, PNG or PDF'), { status: 400 });
    const sub = String(d.subType || d.document_sub_type || 'passport');
    if (!DOC_TYPES.includes(sub)) throw Object.assign(new Error('Unknown document kind'), { status: 400 });
    return { document_type: 'identity_verification', document_sub_type: sub, content, mime_type: mime };
  });
}

// Yes/no answers arrive as booleans from checkboxes or as "yes"/"no" from radio buttons.
const yes = v => v === true || v === 'yes' || v === 'true' || v === 'on' || v === 1;

// Maps the onboarding form to the Broker API account schema. SSN and other identity data are
// forwarded to Alpaca only; this app never stores them.
export function buildAccountRequest(f, ip, now = new Date()) {
  const req = (v, name) => { if (v === undefined || v === null || String(v).trim() === '') throw Object.assign(new Error(`${name} is required`), { status: 400 }); return String(v).trim(); };
  const ssn = req(f.ssn, 'Social Security number').replace(/\D/g, '');
  if (!/^\d{9}$/.test(ssn)) throw Object.assign(new Error('Social Security number must have 9 digits'), { status: 400 });
  const dob = req(f.dateOfBirth, 'Date of birth');
  const age = (now - new Date(dob)) / (365.25 * 86400e3);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || !(age >= 18 && age < 120)) throw Object.assign(new Error('You must be at least 18 years old'), { status: 400 });
  const email = req(f.email, 'Email');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error('Enter a valid email'), { status: 400 });
  const phone = req(f.phone, 'Phone').replace(/[\s().-]/g, '');
  if (!/^\+?\d{10,15}$/.test(phone)) throw Object.assign(new Error('Enter a valid phone number'), { status: 400 });
  const postal = req(f.postalCode, 'ZIP code');
  if (!/^\d{5}(-\d{4})?$/.test(postal)) throw Object.assign(new Error('ZIP code must have 5 digits'), { status: 400 });
  const country = c => { const v = String(c || '').toUpperCase(); if (!/^[A-Z]{3}$/.test(v)) throw Object.assign(new Error('Countries use 3-letter codes'), { status: 400 }); return v; };
  if (!yes(f.agreeCustomer)) throw Object.assign(new Error('You must accept the Alpaca Customer Agreement'), { status: 400 });
  const margin = yes(f.margin), crypto = yes(f.crypto), options = yes(f.options);
  const signedAt = now.toISOString();
  const agreements = ['customer_agreement', 'account_agreement', ...(margin ? ['margin_agreement'] : []), ...(crypto ? ['crypto_agreement'] : []), ...(options ? ['options_agreement'] : [])];
  const citizenship = country(req(f.citizenship, 'Country of citizenship'));
  const documents = buildDocuments(f.documents);
  return {
    contact: {
      email_address: email,
      phone_number: phone.startsWith('+') ? phone : '+1' + phone.replace(/^1(?=\d{10}$)/, ''),
      street_address: [req(f.street, 'Street address')],
      unit: f.unit || undefined,
      city: req(f.city, 'City'),
      state: req(f.state, 'State'),
      postal_code: postal,
      country: 'USA',
    },
    identity: {
      given_name: req(f.givenName, 'First name'),
      middle_name: f.middleName || undefined,
      family_name: req(f.familyName, 'Last name'),
      date_of_birth: dob,
      tax_id: `${ssn.slice(0, 3)}-${ssn.slice(3, 5)}-${ssn.slice(5)}`,
      tax_id_type: 'USA_SSN',
      country_of_citizenship: citizenship,
      country_of_birth: f.countryOfBirth ? country(f.countryOfBirth) : citizenship,
      country_of_tax_residence: f.taxResidence ? country(f.taxResidence) : 'USA',
      funding_source: [f.fundingSource || 'employment_income'],
    },
    disclosures: {
      is_control_person: yes(f.isControlPerson),
      is_affiliated_exchange_or_finra: yes(f.isAffiliated),
      is_politically_exposed: yes(f.isPoliticallyExposed),
      immediate_family_exposed: yes(f.familyExposed),
      employment_status: f.employmentStatus || undefined,
      employer_name: f.employerName || undefined,
      employment_position: f.employmentPosition || undefined,
    },
    agreements: agreements.map(agreement => ({ agreement, signed_at: signedAt, ip_address: ip || '127.0.0.1' })),
    ...(documents.length ? { documents } : {}),
    enabled_assets: ['us_equity', ...(crypto ? ['crypto'] : []), ...(options ? ['us_option'] : [])],
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

// What the applicant sees for each status: a headline, a line of detail and what they can do.
export function statusInfo(status) {
  const s = String(status || '');
  if (s === 'ACTIVE') return { tone: 'ok', title: 'Account approved! Ready to trade', detail: 'Fund your account by linking a bank below, then place your first trade.', action: 'fund' };
  if (s === 'APPROVED') return { tone: 'ok', title: 'Account approved! Ready to trade', detail: 'Alpaca is switching the account on. This usually takes a few minutes.', action: null };
  if (s === 'ACTION_REQUIRED') return { tone: 'warn', title: 'Action required: upload documents', detail: 'Alpaca needs more documents to verify your identity. Upload a passport or driver\'s license below.', action: 'documents' };
  if (s === 'APPROVAL_PENDING' || s === 'REAPPROVAL_PENDING') return { tone: 'wait', title: 'Pending manual review', detail: 'A compliance officer at Alpaca is reviewing your application. This can take up to 1 business day.', action: null };
  if (s === 'REJECTED') return { tone: 'bad', title: 'Application rejected', detail: 'Alpaca could not approve this application. Contact support if you think this is a mistake.', action: 'support' };
  if (s === 'SUBMISSION_FAILED') return { tone: 'bad', title: 'Submission failed', detail: 'The application did not reach Alpaca\'s review. Contact support and we will help.', action: 'support' };
  if (s === 'DISABLED' || s === 'ACCOUNT_CLOSED') return { tone: 'bad', title: s === 'DISABLED' ? 'Account disabled' : 'Account closed', detail: 'Trading is not available on this account.', action: 'support' };
  return { tone: 'wait', title: 'Application under review', detail: 'Alpaca is verifying your identity. Most applications are decided within minutes.', action: null };
}
export const FINAL_STATUSES = ['ACTIVE', 'REJECTED', 'ACCOUNT_CLOSED', 'DISABLED'];
