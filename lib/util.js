'use strict';
const crypto = require('crypto');

const pad = n => String(n).padStart(2, '0');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const a = crypto.scryptSync(String(password), salt, 64);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const uid = (p = 'id') => `${p}_${crypto.randomBytes(6).toString('hex')}`;
const token = () => crypto.randomBytes(32).toString('hex');

const toMin = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
const fromMin = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const dateOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => dateOf(new Date());
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return dateOf(d); };
const weekday = s => parseDate(s).getDay(); // 0 = svētdiena
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const ts = (date, min) => { const d = parseDate(date); d.setMinutes(min); return d.getTime(); };

const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && dateOf(parseDate(s)) === s;
const isTime = s => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

module.exports = { hashPassword, verifyPassword, uid, token, toMin, fromMin, dateOf, today, parseDate, addDays, weekday, nowMin, ts, isDate, isTime };
