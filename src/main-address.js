// Whether the site's main address (PUBLIC_URL) really reaches this server: the one-address redirect
// (server.js) is on only then, and Admin → Hosting shows a warning when it is not. Written by the
// server's own check (every 5 minutes), read by the hosting page.
let reaches = false;
export const mainAddressReaches = () => reaches;
export const setMainAddressReaches = v => { reaches = v === true; };
export function mainAddressWarning(url, ok) {
  if (ok) return null;
  return `The main address ${url || '(PUBLIC_URL is not set)'} does not reach this server yet, so visitors on the server's own address are not redirected to it. Check the DNS for the address: it must point at this server (an A record to its IP).`;
}
