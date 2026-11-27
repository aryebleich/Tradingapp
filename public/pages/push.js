// This device: push notifications (Settings → Notifications) and the install guide for iPhone, Windows
// and Mac (the Apps page). Queue row APP-02; registry AL-12, AP-02..AP-04. Push is opt-in per device
// and per kind; the server sends nothing until the member turns it on here.
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const key = b64 => { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)); return Uint8Array.from(s, c => c.charCodeAt(0)); };

export async function notificationsCard(el, H) {
  const d = await H.api('/push');
  const reg = supported() ? await navigator.serviceWorker.getRegistration() : null;
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  const here = sub && d.devices.length;
  el.innerHTML = `<h2>Notifications on this device</h2>
    <p class="mu" style="margin-top:0">Get your alerts here even when Brightolio is closed. Free, and only for what you tick. Email and text alerts keep working as before.</p>
    ${!supported() ? '<p class="mu">This browser can\'t show notifications. On an iPhone, add Brightolio to your Home Screen first (Share → Add to Home Screen), then open it from there.</p>' : `
    <div class="row" style="gap:16px">${Object.entries(d.kinds).map(([k, v]) => `<label class="chk"><input type="checkbox" name="kind" value="${k}" ${!here || (d.devices.find(x => x.kinds.includes(k))) ? 'checked' : ''}> ${H.esc(v)}</label>`).join('')}</div>
    <p><button type="button" id="pushOn">${here ? 'Save' : 'Turn on for this device'}</button> ${here ? '<button type="button" class="ghost" id="pushTest">Send a test</button> <button type="button" class="ghost" id="pushOff">Turn off on this device</button>' : ''} <span class="ok" role="status"></span></p>
    <div class="err" role="alert"></div>`}
    ${d.devices.length ? `<p class="mu small-print">On for ${d.devices.length} device${d.devices.length === 1 ? '' : 's'}: ${d.devices.map(x => H.esc(x.device)).join(', ')}.</p>` : ''}`;
  if (!supported()) return;
  const ok = H.$('.ok', el), err = H.$('.err', el);
  const kinds = () => H.$$('[name=kind]', el).filter(c => c.checked).map(c => c.value);
  H.$('#pushOn', el).onclick = async () => {
    err.textContent = ''; ok.textContent = '';
    try {
      if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') { err.textContent = 'Notifications are blocked for this site. Allow them in the browser\'s site settings, then try again.'; return; }
      const r = reg || await navigator.serviceWorker.register('/sw.js');
      const s = sub || await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(d.publicKey) });
      await H.api('/push/subscribe', { body: { subscription: s.toJSON(), kinds: kinds() } });
      await notificationsCard(el, H); H.$('.ok', el).textContent = 'On for this device.';
    } catch (e) { err.textContent = e.message; }
  };
  if (H.$('#pushTest', el)) H.$('#pushTest', el).onclick = async () => { const r = await H.api('/push/test', { body: {} }).catch(e => ({ error: e.message })); ok.textContent = r.sent ? 'Sent. It should appear in a moment.' : r.error || 'Nothing was sent: turn on "Price and scanner alerts" first.'; };
  if (H.$('#pushOff', el)) H.$('#pushOff', el).onclick = async () => { await H.api('/push/unsubscribe', { body: { endpoint: sub.endpoint } }); await sub.unsubscribe().catch(() => {}); await notificationsCard(el, H); };
}

// How to install Brightolio as an app on each device (one installable web app; DECISIONS.md MP-6).
export function installGuide(el, H) {
  const ua = navigator.userAgent, now = /iPhone|iPad/.test(ua) ? 'ios' : /Mac/.test(ua) ? 'mac' : /Windows/.test(ua) ? 'win' : /Android/.test(ua) ? 'android' : '';
  const rows = [
    ['ios', 'iPhone and iPad', 'Open app.brightolio.com in Safari, tap Share, then "Add to Home Screen". Open it from the Home Screen to get notifications.'],
    ['win', 'Windows', 'In Edge or Chrome, open app.brightolio.com and choose "Install Brightolio" (the install icon at the right of the address bar, or the menu → Apps).'],
    ['mac', 'Mac', 'In Safari choose File → Add to Dock; in Chrome or Edge use the install icon at the right of the address bar.'],
    ['android', 'Android', 'Use the Brightolio app from this page, or in Chrome choose the menu → "Install app".'],
  ];
  el.innerHTML = `<h2>Install on iPhone, Windows and Mac</h2>
    <p class="mu" style="margin-top:0">Brightolio installs as an app from the browser: its own window and icon, notifications, and your watchlists open even without a connection (as saved on your last visit).</p>
    <ul class="plain">${rows.map(([k, t, how]) => `<li style="margin-bottom:8px"><b>${t}</b>${k === now ? ' <span class="pill">This device</span>' : ''}<br><span class="mu">${how}</span></li>`).join('')}</ul>`;
}
