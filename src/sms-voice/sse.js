// Server-Sent Events, one stream per signed-in user (several tabs allowed, up to `max`). Events are
// pushed with publish(userId, name, data). The stream carries message text and phone numbers only to
// the user they belong to; nothing is logged.
const conns = new Map(); // userId -> Set<res>
let seq = 0;

export function subscribe(req, res, userId, { max = 5, heartbeatMs = 25000 } = {}) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 5000\n\n');
  let set = conns.get(userId); if (!set) conns.set(userId, (set = new Set()));
  while (set.size >= max) { const oldest = set.values().next().value; set.delete(oldest); try { oldest.end(); } catch {} }
  set.add(res);
  const beat = setInterval(() => { try { res.write(': ping\n\n'); res.flush?.(); } catch {} }, heartbeatMs);
  beat.unref?.();
  const done = () => { clearInterval(beat); const s = conns.get(userId); if (s) { s.delete(res); if (!s.size) conns.delete(userId); } };
  req.on('close', done); res.on('close', done);
  res.flush?.();
}

export function publish(userId, name, data) {
  const set = conns.get(userId); if (!set) return 0;
  const frame = `id: ${++seq}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  let n = 0;
  for (const res of set) { try { res.write(frame); res.flush?.(); n++; } catch { set.delete(res); } }
  return n;
}
// One event to one connection (used to replay what is waiting when a tab connects).
export function send(res, name, data) { try { res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`); res.flush?.(); return true; } catch { return false; } }
export const online = userId => (conns.get(userId)?.size || 0) > 0;
export const connectionCount = userId => conns.get(userId)?.size || 0;
export function closeAll() { for (const set of conns.values()) for (const res of set) try { res.end(); } catch {} conns.clear(); }
