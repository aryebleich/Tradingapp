// Short lessons that unlock high-risk instruments with real money, and the risk notices
// ("speed bumps") a user confirms before trading them. Answers are checked on the server.
import express from 'express';
import { requireUser } from './auth.js';
import { getSetting, setSetting } from './settings.js';
import { audit } from './db.js';

export const LESSONS = {
  basics: { title: 'Investing basics', minutes: 3, body: ['A diversified portfolio spreads risk across many companies; one stock can fall 50% or more.', 'Returns compound over years. Small daily gains and losses matter less than staying invested and keeping costs low.', 'A backtest shows what would have happened, not what will happen.'],
    quiz: [{ q: 'What does diversification do?', a: ['Guarantees a profit', 'Spreads risk so one loss hurts less', 'Doubles returns'], correct: 1 }, { q: 'A strong backtest means...', a: ['The strategy will make money', 'It worked on past data only', 'Risk is zero'], correct: 1 }] },
  options: { title: 'Options: the risks', minutes: 4, body: ['An option can lose its whole value by expiration. Most short-dated options bought expire worthless.', 'Selling options can lose far more than the premium collected; a naked call has unlimited risk.', 'Time decay works against buyers every day, and implied volatility can fall after news even if you guessed the direction.'],
    quiz: [{ q: 'What is the most a call buyer can lose?', a: ['The premium paid', 'Nothing', 'Unlimited'], correct: 0 }, { q: 'Time decay helps...', a: ['Option buyers', 'Option sellers', 'Nobody'], correct: 1 }, { q: 'Selling a call without owning the shares has...', a: ['Limited risk', 'Unlimited risk', 'No risk'], correct: 1 }] },
  crypto: { title: 'Crypto: the risks', minutes: 3, body: ['Crypto trades 24/7 and can move 10% or more in a day.', 'It is not protected like a bank deposit, and prices can fall close to zero.', 'Only invest what you could lose entirely.'],
    quiz: [{ q: 'A 10% daily move in crypto is...', a: ['Impossible', 'Not unusual', 'Guaranteed upward'], correct: 1 }, { q: 'Crypto held at a broker is insured like a bank deposit.', a: ['True', 'False'], correct: 1 }] },
  margin: { title: 'Margin: the risks', minutes: 3, body: ['Margin is a loan from your broker; gains and losses are both magnified.', 'If your account falls below the maintenance requirement, the broker can sell your positions without asking.', 'You pay interest on what you borrow and can lose more than you deposited.'],
    quiz: [{ q: 'On margin, a 20% drop on 2x leverage loses about...', a: ['10%', '20%', '40%'], correct: 2 }, { q: 'In a margin call the broker may...', a: ['Sell your positions', 'Give you more time always', 'Cancel the loan'], correct: 0 }] },
};
export const NOTICES = {
  options: 'Options are complex and can expire worthless. You can lose the full premium, and selling options can lose much more than you collect.',
  crypto: 'Crypto is highly volatile, trades around the clock and is not insured like a bank deposit. Prices can fall sharply and quickly.',
  margin: 'Trading on margin magnifies losses. You can lose more than you deposit, and positions may be sold without notice.',
};

export const lessonsRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', async (req, res) => {
    const done = await getSetting(req.user.id, 'lessons', {});
    res.json({ lessons: Object.entries(LESSONS).map(([id, l]) => ({ id, title: l.title, minutes: l.minutes, body: l.body, quiz: l.quiz.map(x => ({ q: x.q, a: x.a })), done: !!done[id] })), notices: NOTICES });
  });
  r.post('/:id', async (req, res) => {
    const l = LESSONS[req.params.id]; if (!l) throw Object.assign(new Error('No such lesson'), { status: 404 });
    const ans = Array.isArray(req.body.answers) ? req.body.answers.map(Number) : [];
    const wrong = l.quiz.map((x, i) => (ans[i] === x.correct ? null : i + 1)).filter(Boolean);
    if (wrong.length) return res.status(422).json({ error: `Not quite: check question ${wrong.join(', ')} and try again.`, wrong });
    const done = await getSetting(req.user.id, 'lessons', {});
    done[req.params.id] = Date.now(); await setSetting(req.user.id, 'lessons', done);
    res.json({ ok: true, done });
  });
  // The risk notice was read (the page makes the user wait 10 seconds before the button works).
  r.post('/ack/:kind', async (req, res) => {
    if (!NOTICES[req.params.kind]) throw Object.assign(new Error('Unknown notice'), { status: 404 });
    await setSetting(req.user.id, 'ack:' + req.params.kind, { at: Date.now() });
    await audit(req.user.id, 'risk_notice_ack', { kind: req.params.kind }, req.ip);
    res.json({ ok: true });
  });
  return r;
})();
