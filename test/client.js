// Starts the app on a free port and returns cookie-keeping API clients (one per user).
export async function serve() {
  const { app } = await import('../server.js');
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    const call = async (path, body, method) => {
      const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined });
      const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    call.signup = email => call('/auth/register', { email, password: 'Str0ngPassword' }).then(r => r.body.user);
    return call;
  };
  return { base, client, close: () => server.close() };
}
