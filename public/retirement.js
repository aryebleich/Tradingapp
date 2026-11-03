// Retirement & IRAs: Traditional vs Roth in plain words, this year's limits, how much you can put
// in, a planner with a chart, and marking which of your accounts are IRAs.
let H;
export function registerRetirement(routes, helpers) { H = helpers; routes.retirement = page; }
const $$m = x => '$' + Math.round(+x || 0).toLocaleString('en-US');

async function page(view) {
  const [d, accts] = await Promise.all([H.api('/retirement'), H.accounts().catch(() => [])]);
  const L = d.limits;
  view.innerHTML = `<div class="pagehead"><h1>Retirement &amp; IRAs</h1><p class="mu">Save for retirement with tax breaks: what Traditional and Roth IRAs are, how much you can put in this year, and what your savings could grow to.</p></div>
  <div class="grid">
    <div class="card"><h2>Traditional or Roth?</h2>
      <table class="slim"><tr><th></th><th>Traditional IRA</th><th>Roth IRA</th></tr>
        <tr><td>Tax break</td><td>Now: contributions can lower this year's taxable income</td><td>Later: withdrawals in retirement are tax-free</td></tr>
        <tr><td>Withdrawals</td><td>Taxed as income</td><td>Tax-free after age 59½ and 5 years</td></tr>
        <tr><td>Who can put money in</td><td>Anyone with earned income (the tax deduction depends on income and workplace plans)</td><td>Only below an income limit</td></tr>
        <tr><td>Required withdrawals</td><td>From age ${L.rmdAge} (${L.rmdAgeFrom1960} if born in 1960 or later)</td><td>None while you are alive</td></tr>
        <tr><td>Taking money out early</td><td colspan="2">Before 59½ usually costs a 10% penalty plus tax (Roth: your own contributions can come out any time)</td></tr></table>
      <p class="mu small-print">A rule of thumb: if you expect a higher tax rate later, Roth; lower later, Traditional. Many people use both.</p></div>
    <div class="card"><h2>${L.year} limits</h2>
      <div class="stats"><div class="stat"><span>IRA (all IRAs together)</span><b>${$$m(L.ira)}</b><span class="mu">+${$$m(L.iraCatchUp)} at 50+</span></div>
      <div class="stat"><span>401(k), 403(b), TSP</span><b>${$$m(L.k401)}</b><span class="mu">+${$$m(L.k401CatchUp)} at 50+, +${$$m(L.k401CatchUp6063)} at 60-63</span></div></div>
      <table class="slim"><tr><th>Roth IRA income limit (modified AGI)</th><th class="num">Full amount below</th><th class="num">Nothing above</th></tr>
        <tr><td>Single</td><td class="num">${$$m(L.roth.single[0])}</td><td class="num">${$$m(L.roth.single[1])}</td></tr>
        <tr><td>Married filing jointly</td><td class="num">${$$m(L.roth.married[0])}</td><td class="num">${$$m(L.roth.married[1])}</td></tr></table>
      <p class="mu small-print">Source: ${H.esc(L.source)}. Check the IRS site for your situation.</p></div>
  </div>
  <form class="card" id="elig"><h2>How much can I put in?</h2>
    <div class="row"><label>Your age<input name="age" type="number" min="0" max="120" value="40"></label>
      <label>Filing<select name="filing"><option value="single">Single / head of household</option><option value="married">Married filing jointly</option><option value="separate">Married filing separately</option></select></label>
      <label>Income (modified AGI, $)<input name="magi" type="number" min="0" step="1000" value="80000"></label>
      <label>Earned income this year ($)<input name="earned" type="number" min="0" step="1000" placeholder="optional"></label></div>
    <label class="chk"><input type="checkbox" name="covered"> I have a retirement plan at work (401k, 403b...)</label>
    <label class="chk"><input type="checkbox" name="spouseCovered"> My spouse has one</label>
    <div id="eOut" style="margin-top:10px"></div></form>
  <form class="card" id="plan"><h2>Retirement planner</h2>
    <div class="row"><label>Age now<input name="age" type="number" value="35" min="0" max="100"></label><label>Retire at<input name="retireAge" type="number" value="65" min="1" max="110"></label>
      <label>Saved so far ($)<input name="saved" type="number" value="10000" min="0" step="1000"></label><label>Add each month ($)<input name="monthly" type="number" value="500" min="0" step="50"></label></div>
    <div class="row"><label>Yearly return % <span class="mu">(stocks have averaged more, with big drops)</span><input name="returnPct" type="number" value="6" step="0.5" min="-5" max="20"></label><label>Inflation %<input name="inflationPct" type="number" value="2.5" step="0.5" min="0" max="15"></label>
      <label>Tax rate now %<input name="taxNowPct" type="number" value="22" min="0" max="60"></label><label>Tax rate in retirement %<input name="taxLaterPct" type="number" value="15" min="0" max="60"></label></div>
    <div id="pOut"></div></form>
  <form class="card" id="acc"><h2>Which of my accounts are IRAs?</h2><p class="mu">Mark an IRA so the Taxes page treats it as tax-sheltered (no capital-gains tax on its trades) and planning counts it as retirement money. The broker opens the IRA itself; this only tells Brightfolio what it is.</p>
    <div class="tablewrap"><table class="slim">${accts.filter(a => a.connected !== false && a.id !== 'paper').map(a => `<tr><td>${H.esc(H.acctLabel ? H.acctLabel(a) : a.name || a.id)}</td><td><select name="${H.esc(a.id)}">${Object.entries(d.types).map(([k, v]) => `<option value="${k}" ${(d.accounts[a.id] || 'taxable') === k ? 'selected' : ''}>${H.esc(v)}</option>`).join('')}</select></td></tr>`).join('') || '<tr><td class="mu">Connect a brokerage account first (Accounts → Choose your brokerage).</td></tr>'}</table></div>
    <div class="row"><button>Save</button></div><div class="err"></div></form>
  <p class="mu small-print">Estimates for planning, not tax or investment advice. Returns are not guaranteed and can be negative. Social Security estimates: <a href="https://www.ssa.gov/myaccount/" target="_blank" rel="noopener">ssa.gov/myaccount</a>.</p>`;

  const elig = H.$('#elig', view), eOut = H.$('#eOut', view);
  const runElig = async () => {
    const f = H.form(elig);
    try {
      const r = await H.api('/retirement/eligibility', { body: { ...f, covered: elig.covered.checked, spouseCovered: elig.spouseCovered.checked } });
      eOut.innerHTML = `<div class="stats"><div class="stat"><span>Roth IRA</span><b>${$$m(r.rothMax)}</b></div><div class="stat"><span>Traditional IRA</span><b>${$$m(r.traditionalMax)}</b><span class="mu">${$$m(r.traditionalDeductible)} tax-deductible</span></div><div class="stat"><span>401(k) at work</span><b>${$$m(r.k401Max)}</b></div></div><ul>${r.notes.map(n => `<li>${H.esc(n)}</li>`).join('')}</ul>`;
    } catch (e) { eOut.innerHTML = `<p class="err">${H.esc(e.message)}</p>`; }
  };
  elig.oninput = runElig; elig.onsubmit = e => { e.preventDefault(); runElig(); }; runElig();

  const pf = H.$('#plan', view), pOut = H.$('#pOut', view);
  const runPlan = async () => {
    try {
      const r = await H.api('/retirement/plan', { body: H.form(pf) }), c = r.compare;
      pOut.innerHTML = `<div class="stats"><div class="stat"><span>At ${H.esc(String(+pf.retireAge.value))}</span><b>${$$m(r.balance)}</b><span class="mu">${$$m(r.realBalance)} in today's dollars</span></div>
        <div class="stat"><span>You put in</span><b>${$$m(r.paidIn)}</b><span class="mu">growth ${$$m(r.growth)}</span></div>
        <div class="stat"><span>Monthly income (4% a year)</span><b>${$$m(r.monthlyIncome)}</b><span class="mu">today's dollars, before tax</span></div>
        <div class="stat"><span>Lasts</span><b>${r.lastsToAge ? 'to age ' + r.lastsToAge : '60+ years'}</b></div></div>
        <canvas id="rch" style="width:100%;height:220px"></canvas>
        <p><b>Roth or Traditional?</b> Putting ${$$m(c.roth.contribution)} a month in a Roth gives about <b>${$$m(c.roth.monthlyIncome)}</b> a month after tax in retirement; the same take-home pay in a Traditional IRA (${$$m(c.traditional.contribution)} a month before tax) gives about <b>${$$m(c.traditional.monthlyIncome)}</b>. ${H.esc(c.why)}</p>`;
      H.drawChart(H.$('#rch', pOut), r.path.map(p => p.balance), { base: r.path[0].balance, dates: r.path.map(p => `${new Date().getFullYear() + (p.age - r.path[0].age)}-01-01`), legend: false });
    } catch (e) { pOut.innerHTML = `<p class="err">${H.esc(e.message)}</p>`; }
  };
  let t; pf.oninput = () => { clearTimeout(t); t = setTimeout(runPlan, 250); }; pf.onsubmit = e => { e.preventDefault(); runPlan(); }; runPlan();

  const af = H.$('#acc', view);
  af.onsubmit = async e => { e.preventDefault(); try { await H.api('/retirement/accounts', { method: 'PUT', body: { accounts: H.form(af) } }); H.$('.err', af).textContent = 'Saved'; } catch (err) { H.$('.err', af).textContent = err.message; } };
}
