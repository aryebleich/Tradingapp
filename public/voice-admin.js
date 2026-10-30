// Admin → Phone line → Yiddish voice: record (or upload) each piece the line says, and the
// numbers. Recordings are made as WAV in the browser, because phones cannot play other formats.
let H;
export async function yiddishVoice(box, helpers, settings) {
  H = helpers;
  const d = await H.api('/admin/site/phone/clips');
  const total = d.numbers.length + d.sentences.length, done = [...d.numbers, ...d.sentences].filter(x => x.id).length;
  const row = x => `<tr data-k="${H.esc(x.k)}"><td><span data-no-tr>${H.esc(x.english)}</span>${x.heard ? `<br><span class="mu" style="font-size:12px">heard ${x.heard}×</span>` : ''}</td>
    <td dir="rtl" lang="yi" data-no-tr>${H.esc(x.yi)}</td>
    <td style="white-space:nowrap">${x.id ? `<button type="button" class="small ghost" data-play="${x.id}" title="Play">▶</button>` : '<span class="mu">-</span>'}
      <button type="button" class="small" data-rec>${x.id ? 'Re-record' : 'Record'}</button>
      <label class="small ghost upl" title="Upload an MP3 or WAV">⤒<input type="file" accept="audio/mpeg,audio/wav,.mp3,.wav" hidden></label>
      ${x.id ? '<button type="button" class="small ghost danger-t" data-del>✕</button>' : ''}</td></tr>`;
  const table = (title, rows, note = '') => rows.length ? `<h3>${title}</h3>${note}<div class="tablewrap"><table class="slim voicetab"><tr><th>English</th><th>Read in Yiddish</th><th></th></tr>${rows.map(row).join('')}</table></div>` : '';
  box.innerHTML = `<div class="card"><h2>Yiddish voice</h2>
    <p class="mu">No phone voice can speak Yiddish, so the line plays your own recordings. Record each piece once (a few seconds each) and the numbers; amounts like 1,250 are put together from the numbers. Anything not recorded yet is read in English, and is listed under "Heard by callers" so you know what to record next.</p>
    <div class="stats"><div class="stat"><span>Recorded</span><b>${done} of ${total}</b></div><div class="stat"><span>Other recordings</span><b>${d.recorded - done}</b></div><div class="stat"><span>Heard, not recorded</span><b>${d.heard.length}</b></div></div>
    <label class="check"><input type="checkbox" id="yion" ${settings.yiddish ? 'checked' : ''}> Callers can press 8 for Yiddish (their choice is kept for their next calls; users can also pick it in Settings → Phone)</label>
    <div class="err" id="yierr"></div>
    ${table('Sentences', d.sentences)}${table('Numbers and small words', d.numbers, '<p class="mu small-print">"איין" is the form inside a bigger number (איין און צוואַנציק); "איינס" is one on its own.</p>')}
    ${table('Heard by callers, not recorded yet', d.heard, '<p class="mu small-print">Read the English part in Yiddish, in your own words.</p>')}${table('Other recordings', d.other)}
    <p class="mu small-print">Tip: record in a quiet room, start speaking right after pressing Record, and press Stop right after. Each recording can be up to about a minute.</p></div>`;

  H.$('#yion', box).onchange = async e => { try { await H.api('/admin/site/phone', { method: 'PUT', body: { yiddish: e.target.checked } }); } catch (x) { H.$('#yierr', box).textContent = x.message; } };
  H.$$('[data-play]', box).forEach(b => (b.onclick = () => new Audio('/voice/yi/' + b.dataset.play).play()));
  const save = async (k, blob) => {
    const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(blob); });
    await H.api('/admin/site/phone/clips', { body: { k, mime: blob.type === 'audio/mp3' ? 'audio/mpeg' : blob.type || 'audio/wav', data } });
    await yiddishVoice(box, H, settings);
  };
  const fail = e => { H.$('#yierr', box).textContent = e.message || String(e); };
  H.$$('tr[data-k]', box).forEach(tr => {
    const k = tr.dataset.k, rec = H.$('[data-rec]', tr), file = H.$('input[type=file]', tr), del = H.$('[data-del]', tr);
    file.onchange = () => file.files[0] && save(k, file.files[0]).catch(fail);
    if (del) del.onclick = async () => { await H.api('/admin/site/phone/clips?k=' + encodeURIComponent(k), { method: 'DELETE' }).catch(fail); yiddishVoice(box, H, settings); };
    rec.onclick = async () => {
      if (rec.stop) return rec.stop();
      try {
        const r = await recordWav();
        rec.textContent = 'Stop'; rec.classList.add('danger');
        rec.stop = async () => { rec.stop = null; rec.disabled = true; await save(k, await r.stop()).catch(fail); };
      } catch (e) { fail(new Error('The microphone could not be opened: ' + e.message)); }
    };
  });
}

// Records the microphone as a 16 kHz mono WAV (a format phones play).
async function recordWav() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext(), src = ctx.createMediaStreamSource(stream), node = ctx.createScriptProcessor(4096, 1, 1), chunks = [];
  node.onaudioprocess = e => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  src.connect(node); node.connect(ctx.destination);
  return {
    async stop() {
      node.disconnect(); src.disconnect(); stream.getTracks().forEach(t => t.stop());
      const rate = ctx.sampleRate; await ctx.close();
      const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0)); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
      const out = 16000, ratio = rate / out, n = Math.floor(all.length / ratio), pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) { const v = Math.max(-1, Math.min(1, all[Math.floor(i * ratio)])); pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff; }
      const buf = new ArrayBuffer(44 + pcm.length * 2), dv = new DataView(buf), w = (p, s) => [...s].forEach((c, i) => dv.setUint8(p + i, c.charCodeAt(0)));
      w(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, out, true); dv.setUint32(28, out * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, pcm.length * 2, true);
      new Int16Array(buf, 44).set(pcm);
      return new Blob([buf], { type: 'audio/wav' });
    },
  };
}
