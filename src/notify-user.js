// Text message when the user has a verified phone, otherwise email.
import { one } from './db.js';
import { sendSms, sendEmail } from './notify.js';
export async function notifyUser(userId, msg) {
  const u = await one('SELECT email, phone, phone_verified FROM users WHERE id = ?', userId);
  if (u?.phone && u.phone_verified) await sendSms(u.phone, msg).catch(e => console.warn('sms', e.message));
  else if (u?.email) await sendEmail(u.email, 'QuantPocket: ' + msg.slice(0, 60), msg).catch(e => console.warn('email', e.message));
}
