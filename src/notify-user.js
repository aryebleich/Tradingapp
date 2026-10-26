// Text message when the user has a verified phone and a paid plan, otherwise email.
import { isPaid } from './fees.js';
import { one } from './db.js';
import { sendSms, sendEmail } from './notify.js';
export async function notifyUser(userId, msg) {
  const u = await one('SELECT email, phone, phone_verified, role, plan, plan_status FROM users WHERE id = ?', userId);
  // Text-message alerts are a paid feature; the free plan gets them by email.
  if (u?.phone && u.phone_verified && isPaid(u)) await sendSms(u.phone, msg).catch(e => console.warn('sms', e.message));
  else if (u?.email) await sendEmail(u.email, 'QuantPocket: ' + msg.slice(0, 60), msg).catch(e => console.warn('email', e.message));
}
