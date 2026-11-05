'use strict';
process.env.TZ = process.env.TZ || 'Europe/Riga';

const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('./lib/store');
const U = require('./lib/util');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const SESSION_DAYS = 30;
const db = store.load();
const save = () => store.save();

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };

/* ------------------------------------------------------------------ helpers */

const OCCUPYING = new Set(['booked', 'completed']);
const STATUSES = ['booked', 'completed', 'cancelled', 'noshow'];
const getUser = id => db.users.find(u => u.id === id);
const getService = id => db.services.find(s => s.id === id);
const clean = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const num = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };

function daySchedule(date) {
  if (db.closures.some(c => c.date === date)) return null;
  const h = db.hours[U.weekday(date)];
  if (!h || !h.open) return null;
  const start = U.toMin(h.start), end = U.toMin(h.end);
  if (!(end > start)) return null;
  const breaks = [];
  if (h.breakStart && h.breakEnd && U.toMin(h.breakEnd) > U.toMin(h.breakStart)) breaks.push([U.toMin(h.breakStart), U.toMin(h.breakEnd)]);
  return { start, end, breaks };
}

const busyIntervals = (date, excludeId) => db.bookings
  .filter(b => b.date === date && OCCUPYING.has(b.status) && b.id !== excludeId)
  .map(b => [U.toMin(b.start), U.toMin(b.end)]);

function computeSlots(date, duration, excludeId) {
  const st = db.settings;
  const today = U.today();
  if (!U.isDate(date) || date < today || date > U.addDays(today, st.bookingDaysAhead)) return [];
  const sch = daySchedule(date);
  if (!sch) return [];
  const busy = busyIntervals(date, excludeId).concat(sch.breaks);
  const minTs = Date.now() + st.minAdvanceHours * 3600e3;
  const out = [];
  for (let t = sch.start; t + duration <= sch.end; t += st.slotStep) {
    if (U.ts(date, t) < minTs) continue;
    if (busy.some(([a, b]) => t < b && t + duration > a)) continue;
    out.push(U.fromMin(t));
  }
  return out;
}

const hasConflict = (date, s, e, excludeId) => busyIntervals(date, excludeId).some(([a, b]) => s < b && e > a);

function publicUser(u, forAdmin = false) {
  if (!u) return null;
  const v = { id: u.id, role: u.role, username: u.username, name: u.name, phone: u.phone, email: u.email, createdAt: u.createdAt, active: u.active !== false };
  if (u.role === 'admin') v.mustChangePassword = !!u.mustChangePassword;
  if (forAdmin) v.notes = u.notes || '';
  return v;
}

function bookingView(b, forAdmin = false) {
  const svc = getService(b.serviceId);
  const v = {
    id: b.id, serviceId: b.serviceId, serviceName: b.serviceName, color: svc ? svc.color : '#6B7F5B',
    date: b.date, start: b.start, end: b.end, price: b.price, status: b.status, note: b.note || '', createdAt: b.createdAt
  };
  v.canModify = b.status === 'booked' && U.ts(b.date, U.toMin(b.start)) - Date.now() >= db.settings.cancelHours * 3600e3;
  if (forAdmin) {
    const u = b.userId ? getUser(b.userId) : null;
    Object.assign(v, {
      userId: b.userId || null, guest: !u,
      clientName: u ? u.name : (b.guestName || 'Klients bez konta'),
      clientPhone: u ? u.phone : (b.guestPhone || ''),
      adminNote: b.adminNote || '', cancelledBy: b.cancelledBy || null
    });
  }
  return v;
}

function publicInfo() {
  const s = db.settings;
  const services = db.services.filter(x => x.active).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(({ id, name, description, duration, price, color }) => ({ id, name, description, duration, price, color }));
  let nextFree = null;
  if (services.length) {
    const minDur = Math.min(...services.map(x => x.duration));
    for (let i = 0; i <= Math.min(30, s.bookingDaysAhead) && !nextFree; i++) {
      const d = U.addDays(U.today(), i);
      const slots = computeSlots(d, minDur);
      if (slots.length) nextFree = { date: d, start: slots[0] };
    }
  }
  return {
    settings: {
      salonName: s.salonName, tagline: s.tagline, about: s.about, address: s.address, phone: s.phone, email: s.email,
      instagram: s.instagram, allowRegistration: s.allowRegistration, cancelHours: s.cancelHours,
      bookingDaysAhead: s.bookingDaysAhead, maxActiveBookings: s.maxActiveBookings
    },
    hours: db.hours, services, nextFree,
    closures: db.closures.filter(c => c.date >= U.today()).map(({ date, reason }) => ({ date, reason }))
  };
}

/* ------------------------------------------------------------------ auth */

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function sessionUser(req) {
  const t = parseCookies(req).sid;
  if (!t) return null;
  const s = db.sessions.find(x => x.token === t);
  if (!s || s.expires < Date.now()) return null;
  const u = getUser(s.userId);
  return u && u.active !== false ? u : null;
}

function startSession(res, user, req) {
  db.sessions = db.sessions.filter(s => s.expires > Date.now());
  const mine = db.sessions.filter(s => s.userId === user.id);
  if (mine.length >= 10) { const drop = new Set(mine.slice(0, mine.length - 9).map(s => s.token)); db.sessions = db.sessions.filter(s => !drop.has(s.token)); }
  const token = U.token();
  db.sessions.push({ token, userId: user.id, expires: Date.now() + SESSION_DAYS * 864e5 });
  save();
  const secure = req.headers['x-forwarded-proto'] === 'https' || process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

// Klienta IP: aiz uzticama starpniekservera (Railway iestata X-Real-IP, ko klients nevar viltot)
// izmanto tā galveni, citādi — tiešā savienojuma adresi. X-Forwarded-For pirmajai vērtībai neuzticamies.
const TRUST_PROXY = !!(process.env.RAILWAY_ENVIRONMENT || process.env.TRUST_PROXY === '1');
function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-real-ip']) return String(req.headers['x-real-ip']).trim();
  return req.socket.remoteAddress || 'unknown';
}

const attempts = new Map();
const LIMIT_MSG = 'Pārāk daudz mēģinājumu. Lūdzu mēģini vēlreiz vēlāk.';
function hit(key, max, windowMs) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.t > windowMs) { attempts.set(key, { n: 1, t: now, w: windowMs }); return true; }
  a.n++;
  return a.n <= max;
}
const isLimited = (key, max) => { const a = attempts.get(key); return !!a && Date.now() - a.t <= a.w && a.n >= max; };
setInterval(() => { const now = Date.now(); for (const [k, a] of attempts) if (now - a.t > a.w) attempts.delete(k); }, 5 * 60e3).unref();

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
function validateUsername(username, exceptId) {
  if (!USERNAME_RE.test(username)) fail(400, 'Lietotājvārdam jābūt 3–32 simboli: mazie burti, cipari, punkts, svītra.');
  if (db.users.some(u => u.username === username && u.id !== exceptId)) fail(409, 'Šāds lietotājvārds jau ir aizņemts.');
}
const validatePassword = p => { if (String(p || '').length < 6) fail(400, 'Parolei jābūt vismaz 6 simbolus garai.'); };

/* ------------------------------------------------------------------ booking logic */

function createBooking({ user, service, date, start, note, by, guestName, guestPhone, force, price, duration }) {
  if (!U.isDate(date) || !U.isTime(start)) fail(400, 'Nederīgs datums vai laiks.');
  const dur = duration || service.duration;
  const s = U.toMin(start), e = s + dur;
  if (e > 24 * 60) fail(400, 'Vizīte nevar beigties pēc pusnakts.');
  if (by === 'client') {
    if (!computeSlots(date, dur).includes(start)) fail(409, 'Šis laiks vairs nav pieejams. Lūdzu izvēlies citu.');
    const active = db.bookings.filter(b => b.userId === user.id && b.status === 'booked' && U.ts(b.date, U.toMin(b.end)) > Date.now()).length;
    if (active >= db.settings.maxActiveBookings) fail(409, `Vienlaikus var būt ne vairāk kā ${db.settings.maxActiveBookings} aktīvi pieraksti.`);
    if (user.selfRegistered && Date.now() - Date.parse(user.createdAt) < 24 * 3600e3 && active >= 1)
      fail(409, `Jauniem kontiem pirmajā diennaktī var būt viens aktīvs pieraksts. Lai pierakstītos vēlreiz, zvani: ${db.settings.phone}`);
  } else if (!force && hasConflict(date, s, e)) {
    fail(409, 'Šis laiks pārklājas ar citu pierakstu.');
  }
  const b = {
    id: U.uid('bkg'), userId: user ? user.id : null, guestName: user ? undefined : clean(guestName, 80), guestPhone: user ? undefined : clean(guestPhone, 40),
    serviceId: service.id, serviceName: service.name, date, start, end: U.fromMin(e),
    price: price ?? service.price, status: 'booked', note: clean(note), createdAt: new Date().toISOString(), createdBy: by
  };
  db.bookings.push(b);
  save();
  return b;
}

/* ------------------------------------------------------------------ stats */

function stats(range) {
  const today = U.today();
  const from = U.addDays(today, -(range - 1));
  const pFrom = U.addDays(from, -range), pTo = U.addDays(from, -1);
  const counted = b => OCCUPYING.has(b.status);
  const cur = db.bookings.filter(b => b.date >= from && b.date <= today);
  const prev = db.bookings.filter(b => b.date >= pFrom && b.date <= pTo);
  const rev = arr => arr.filter(counted).reduce((s, b) => s + (+b.price || 0), 0);
  const cnt = arr => arr.filter(counted).length;
  const delta = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : null);

  const byDay = new Map();
  for (const b of cur) if (counted(b)) {
    const d = byDay.get(b.date) || { revenue: 0, count: 0 };
    d.revenue += +b.price || 0; d.count++;
    byDay.set(b.date, d);
  }
  const series = [];
  for (let i = 0; i < range; i++) {
    const d = U.addDays(from, i);
    series.push({ date: d, ...(byDay.get(d) || { revenue: 0, count: 0 }) });
  }

  const clients = db.users.filter(u => u.role === 'client');
  const createdDay = u => U.dateOf(new Date(u.createdAt));
  const newClients = clients.filter(u => createdDay(u) >= from).length;
  const newClientsPrev = clients.filter(u => createdDay(u) >= pFrom && createdDay(u) <= pTo).length;

  // noslodze nākamās 7 dienas
  let avail = 0, booked = 0;
  for (let i = 0; i < 7; i++) {
    const d = U.addDays(today, i);
    const sch = daySchedule(d);
    if (!sch) continue;
    avail += sch.end - sch.start - sch.breaks.reduce((s, [a, b]) => s + (b - a), 0);
    booked += busyIntervals(d).reduce((s, [a, b]) => s + (b - a), 0);
  }

  const svcMap = new Map();
  for (const b of cur) if (counted(b)) {
    const svc = getService(b.serviceId);
    const k = b.serviceName;
    const v = svcMap.get(k) || { name: k, count: 0, revenue: 0, color: svc ? svc.color : '#D9C9B2' };
    v.count++; v.revenue += +b.price || 0;
    svcMap.set(k, v);
  }
  const weekdays = [0, 0, 0, 0, 0, 0, 0]; // P..Sv
  for (const b of cur) if (counted(b)) weekdays[(U.weekday(b.date) + 6) % 7]++;

  const hours = {};
  for (const b of cur) if (counted(b)) { const h = b.start.slice(0, 2); hours[h] = (hours[h] || 0) + 1; }

  const spend = new Map();
  for (const b of db.bookings) if (b.userId && counted(b) && b.date <= today) {
    const v = spend.get(b.userId) || { spent: 0, visits: 0, last: '' };
    v.spent += +b.price || 0; v.visits++; if (b.date > v.last) v.last = b.date;
    spend.set(b.userId, v);
  }
  const topClients = [...spend.entries()].map(([id, v]) => ({ id, name: getUser(id)?.name || 'Dzēsts klients', ...v }))
    .sort((a, b) => b.spent - a.spent).slice(0, 5);

  const future = db.bookings.filter(b => b.status === 'booked' && (b.date > today || (b.date === today && U.toMin(b.start) >= U.nowMin())));
  const unmarked = db.bookings.filter(b => b.status === 'booked' && U.ts(b.date, U.toMin(b.end)) < Date.now()).length;
  const lost = cur.filter(b => b.status === 'cancelled' || b.status === 'noshow').length;

  return {
    range, from, to: today,
    kpi: {
      revenue: rev(cur), revenueDelta: delta(rev(cur), rev(prev)),
      bookings: cnt(cur), bookingsDelta: delta(cnt(cur), cnt(prev)),
      avgTicket: cnt(cur) ? rev(cur) / cnt(cur) : 0,
      newClients, newClientsDelta: delta(newClients, newClientsPrev), totalClients: clients.length,
      occupancy: avail ? Math.round((booked / avail) * 100) : 0,
      cancelRate: cur.length ? Math.round((lost / cur.length) * 100) : 0,
      upcomingCount: future.length, upcomingRevenue: future.reduce((s, b) => s + (+b.price || 0), 0),
      unmarked
    },
    series,
    services: [...svcMap.values()].sort((a, b) => b.count - a.count),
    weekdays, hours, topClients,
    today: db.bookings.filter(b => b.date === today && b.status !== 'cancelled').sort((a, b) => a.start.localeCompare(b.start)).map(b => bookingView(b, true))
  };
}

/* ------------------------------------------------------------------ routes */

const routes = [];
const route = (method, pattern, access, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, access, handler });
};

// --- publiski
route('GET', '/api/public', null, () => publicInfo());

route('GET', '/api/me', null, ({ user }) => ({ user: publicUser(user) }));

route('POST', '/api/login', null, ({ body, req, res }) => {
  const username = clean(body.username, 64).toLowerCase();
  if (!hit('ip:' + clientIp(req), 20, 15 * 60e3)) fail(429, LIMIT_MSG);
  // konta līmeņa aizsardzība: pēc 10 neveiksmēm 15 min — neatkarīgi no IP
  if (isLimited('user:' + username, 10)) fail(429, 'Pārāk daudz neveiksmīgu mēģinājumu šim kontam. Mēģini vēlreiz pēc 15 minūtēm.');
  const u = db.users.find(x => x.username === username);
  if (!u || !U.verifyPassword(body.password || '', u.salt, u.hash)) {
    if (u) hit('user:' + username, 10, 15 * 60e3);
    fail(401, 'Nepareizs lietotājvārds vai parole.');
  }
  attempts.delete('user:' + username);
  if (u.active === false) fail(403, 'Šis konts ir bloķēts. Lūdzu sazinies ar salonu.');
  startSession(res, u, req);
  return { user: publicUser(u) };
});

route('POST', '/api/register', null, ({ body, req, res }) => {
  if (!hit('regtry:' + clientIp(req), 30, 60 * 60e3)) fail(429, LIMIT_MSG);
  if (!db.settings.allowRegistration) fail(403, 'Reģistrācija šobrīd ir slēgta. Pieeju vari saņemt salonā.');
  const username = clean(body.username, 64).toLowerCase();
  const name = clean(body.name, 80), phone = clean(body.phone, 40), email = clean(body.email, 120);
  if (name.length < 2) fail(400, 'Lūdzu ievadi vārdu un uzvārdu.');
  if (phone.replace(/\D/g, '').length < 8) fail(400, 'Lūdzu ievadi derīgu tālruņa numuru.');
  validateUsername(username);
  validatePassword(body.password);
  // ne vairāk kā 5 jauni konti stundā no vienas IP
  if (!hit('reg:' + clientIp(req), 5, 60 * 60e3)) fail(429, LIMIT_MSG);
  const { salt, hash } = U.hashPassword(body.password);
  const u = { id: U.uid('usr'), role: 'client', username, name, phone, email, salt, hash, active: true, notes: '', createdAt: new Date().toISOString(), selfRegistered: true };
  db.users.push(u);
  startSession(res, u, req);
  return { user: publicUser(u) };
});

route('POST', '/api/logout', null, ({ req, res }) => {
  const t = parseCookies(req).sid;
  db.sessions = db.sessions.filter(s => s.token !== t);
  save();
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  return { ok: true };
});

// --- pieejamība (jebkurš pieslēdzies lietotājs)
route('GET', '/api/slots', 'any', ({ query, user }) => {
  const svc = getService(query.serviceId);
  if (!svc) fail(404, 'Pakalpojums nav atrasts.');
  let exclude;
  if (query.exclude) {
    const b = db.bookings.find(x => x.id === query.exclude);
    if (b && (user.role === 'admin' || b.userId === user.id)) exclude = b.id;
  }
  return { date: query.date, slots: computeSlots(query.date, svc.duration, exclude) };
});

route('GET', '/api/days', 'any', ({ query, user }) => {
  const svc = getService(query.serviceId);
  if (!svc) fail(404, 'Pakalpojums nav atrasts.');
  if (!/^\d{4}-\d{2}$/.test(query.month || '')) fail(400, 'Nederīgs mēnesis.');
  let exclude;
  if (query.exclude) {
    const b = db.bookings.find(x => x.id === query.exclude);
    if (b && (user.role === 'admin' || b.userId === user.id)) exclude = b.id;
  }
  const [y, m] = query.month.split('-').map(Number);
  const days = {};
  const last = new Date(y, m, 0).getDate();
  for (let d = 1; d <= last; d++) {
    const ds = `${query.month}-${String(d).padStart(2, '0')}`;
    days[ds] = computeSlots(ds, svc.duration, exclude).length;
  }
  return { days, closures: db.closures.filter(c => c.date.startsWith(query.month)) };
});

// --- klients
const myBooking = (user, id) => {
  const b = db.bookings.find(x => x.id === id && x.userId === user.id);
  if (!b) fail(404, 'Pieraksts nav atrasts.');
  return b;
};
const assertModifiable = b => {
  if (b.status !== 'booked') fail(409, 'Šo pierakstu vairs nevar mainīt.');
  if (U.ts(b.date, U.toMin(b.start)) - Date.now() < db.settings.cancelHours * 3600e3)
    fail(409, `Pierakstu var mainīt ne vēlāk kā ${db.settings.cancelHours} h pirms vizītes. Lūdzu zvani: ${db.settings.phone}`);
};

route('GET', '/api/my/bookings', 'client', ({ user }) => ({
  bookings: db.bookings.filter(b => b.userId === user.id).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).map(b => bookingView(b))
}));

route('POST', '/api/my/bookings', 'client', ({ user, body }) => {
  const svc = getService(body.serviceId);
  if (!svc || !svc.active) fail(404, 'Pakalpojums nav pieejams.');
  return { booking: bookingView(createBooking({ user, service: svc, date: body.date, start: body.start, note: body.note, by: 'client' })) };
});

route('PUT', '/api/my/bookings/:id', 'client', ({ user, body, params }) => {
  const b = myBooking(user, params.id);
  assertModifiable(b);
  const svc = getService(b.serviceId);
  const dur = U.toMin(b.end) - U.toMin(b.start);
  if (!computeSlots(body.date, svc ? svc.duration : dur, b.id).includes(body.start)) fail(409, 'Šis laiks vairs nav pieejams. Lūdzu izvēlies citu.');
  b.date = body.date; b.start = body.start; b.end = U.fromMin(U.toMin(body.start) + (svc ? svc.duration : dur));
  b.updatedAt = new Date().toISOString(); b.rescheduled = (b.rescheduled || 0) + 1;
  save();
  return { booking: bookingView(b) };
});

route('POST', '/api/my/bookings/:id/cancel', 'client', ({ user, params }) => {
  const b = myBooking(user, params.id);
  assertModifiable(b);
  b.status = 'cancelled'; b.cancelledBy = 'client'; b.updatedAt = new Date().toISOString();
  save();
  return { booking: bookingView(b) };
});

route('PUT', '/api/my/profile', 'client', ({ user, body }) => {
  const name = clean(body.name, 80), phone = clean(body.phone, 40);
  if (name.length < 2) fail(400, 'Lūdzu ievadi vārdu.');
  if (phone.replace(/\D/g, '').length < 8) fail(400, 'Lūdzu ievadi derīgu tālruņa numuru.');
  Object.assign(user, { name, phone, email: clean(body.email, 120) });
  save();
  return { user: publicUser(user) };
});

route('POST', '/api/password', 'any', ({ user, body, req }) => {
  if (!U.verifyPassword(body.current || '', user.salt, user.hash)) fail(400, 'Pašreizējā parole nav pareiza.');
  validatePassword(body.next);
  if (user.role === 'admin' && body.username) {
    const un = clean(body.username, 64).toLowerCase();
    validateUsername(un, user.id);
    user.username = un;
  }
  Object.assign(user, U.hashPassword(body.next));
  user.mustChangePassword = false;
  const cur = parseCookies(req).sid;
  db.sessions = db.sessions.filter(s => s.userId !== user.id || s.token === cur); // izrakstīt citas ierīces
  save();
  return { user: publicUser(user) };
});

// --- administrators
route('GET', '/api/admin/stats', 'admin', ({ query }) => stats(num(query.range, 7, 365, 30)));

route('GET', '/api/admin/bookings', 'admin', ({ query }) => {
  const from = U.isDate(query.from) ? query.from : '0000-00-00';
  const to = U.isDate(query.to) ? query.to : '9999-12-31';
  const q = clean(query.q, 80).toLowerCase();
  let list = db.bookings.filter(b => b.date >= from && b.date <= to);
  if (query.status && STATUSES.includes(query.status)) list = list.filter(b => b.status === query.status);
  if (query.userId) list = list.filter(b => b.userId === query.userId);
  let views = list.map(b => bookingView(b, true));
  if (q) views = views.filter(v => (v.clientName + ' ' + v.clientPhone + ' ' + v.serviceName).toLowerCase().includes(q));
  views.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  if (query.order === 'desc') views.reverse();
  return { bookings: views };
});

route('POST', '/api/admin/bookings', 'admin', ({ body }) => {
  const svc = getService(body.serviceId);
  if (!svc) fail(404, 'Pakalpojums nav atrasts.');
  let user = null;
  if (body.userId) { user = getUser(body.userId); if (!user) fail(404, 'Klients nav atrasts.'); }
  else if (clean(body.guestName).length < 2) fail(400, 'Izvēlies klientu vai ievadi klienta vārdu.');
  const price = body.price === '' || body.price == null ? undefined : num(body.price, 0, 100000, svc.price);
  const duration = body.duration ? num(body.duration, 5, 720, svc.duration) : undefined;
  const b = createBooking({ user, service: svc, date: body.date, start: body.start, note: body.note, by: 'admin', guestName: body.guestName, guestPhone: body.guestPhone, force: !!body.force, price, duration });
  if (body.adminNote) { b.adminNote = clean(body.adminNote); save(); }
  return { booking: bookingView(b, true) };
});

route('PUT', '/api/admin/bookings/:id', 'admin', ({ body, params }) => {
  const b = db.bookings.find(x => x.id === params.id);
  if (!b) fail(404, 'Pieraksts nav atrasts.');
  const next = { ...b };
  if (body.serviceId && body.serviceId !== b.serviceId) {
    const svc = getService(body.serviceId);
    if (!svc) fail(404, 'Pakalpojums nav atrasts.');
    next.serviceId = svc.id; next.serviceName = svc.name;
    if (body.price === undefined) next.price = svc.price;
    if (!body.duration) body.duration = svc.duration;
  }
  if (body.date !== undefined) { if (!U.isDate(body.date)) fail(400, 'Nederīgs datums.'); next.date = body.date; }
  if (body.start !== undefined) { if (!U.isTime(body.start)) fail(400, 'Nederīgs laiks.'); next.start = body.start; }
  const dur = body.duration ? num(body.duration, 5, 720, 60) : U.toMin(b.end) - U.toMin(b.start);
  next.end = U.fromMin(U.toMin(next.start) + dur);
  if (U.toMin(next.start) + dur > 24 * 60) fail(400, 'Vizīte nevar beigties pēc pusnakts.');
  if (body.status !== undefined) { if (!STATUSES.includes(body.status)) fail(400, 'Nederīgs statuss.'); next.status = body.status; if (body.status === 'cancelled' && b.status !== 'cancelled') next.cancelledBy = 'admin'; }
  if (body.price !== undefined && body.price !== '') next.price = num(body.price, 0, 100000, b.price);
  if (body.note !== undefined) next.note = clean(body.note);
  if (body.adminNote !== undefined) next.adminNote = clean(body.adminNote);
  if (body.userId !== undefined) {
    if (body.userId) { if (!getUser(body.userId)) fail(404, 'Klients nav atrasts.'); next.userId = body.userId; delete next.guestName; delete next.guestPhone; }
  }
  if (body.guestName !== undefined && !next.userId) next.guestName = clean(body.guestName, 80);
  if (body.guestPhone !== undefined && !next.userId) next.guestPhone = clean(body.guestPhone, 40);
  const moved = next.date !== b.date || next.start !== b.start || next.end !== b.end || (OCCUPYING.has(next.status) && !OCCUPYING.has(b.status));
  if (moved && OCCUPYING.has(next.status) && !body.force && hasConflict(next.date, U.toMin(next.start), U.toMin(next.end), b.id))
    fail(409, 'Šis laiks pārklājas ar citu pierakstu.');
  next.updatedAt = new Date().toISOString();
  Object.assign(b, next);
  save();
  return { booking: bookingView(b, true) };
});

route('DELETE', '/api/admin/bookings/:id', 'admin', ({ params }) => {
  const i = db.bookings.findIndex(x => x.id === params.id);
  if (i < 0) fail(404, 'Pieraksts nav atrasts.');
  db.bookings.splice(i, 1);
  save();
  return { ok: true };
});

route('POST', '/api/admin/bookings/mark-past', 'admin', () => {
  let n = 0;
  for (const b of db.bookings) if (b.status === 'booked' && U.ts(b.date, U.toMin(b.end)) < Date.now()) { b.status = 'completed'; n++; }
  save();
  return { updated: n };
});

function clientSummary(u) {
  const list = db.bookings.filter(b => b.userId === u.id);
  const done = list.filter(b => OCCUPYING.has(b.status) && b.date <= U.today());
  const upcoming = list.filter(b => b.status === 'booked' && b.date >= U.today());
  return {
    ...publicUser(u, true),
    visits: done.length, spent: done.reduce((s, b) => s + (+b.price || 0), 0),
    lastVisit: done.map(b => b.date).sort().pop() || null,
    nextVisit: upcoming.map(b => b.date + ' ' + b.start).sort()[0] || null,
    noShows: list.filter(b => b.status === 'noshow').length
  };
}

route('GET', '/api/admin/clients', 'admin', () => ({
  clients: db.users.filter(u => u.role === 'client').map(clientSummary).sort((a, b) => a.name.localeCompare(b.name, 'lv'))
}));

route('POST', '/api/admin/clients', 'admin', ({ body }) => {
  const username = clean(body.username, 64).toLowerCase();
  const name = clean(body.name, 80);
  if (name.length < 2) fail(400, 'Lūdzu ievadi klienta vārdu.');
  validateUsername(username);
  validatePassword(body.password);
  const { salt, hash } = U.hashPassword(body.password);
  const u = {
    id: U.uid('usr'), role: 'client', username, name, phone: clean(body.phone, 40), email: clean(body.email, 120),
    salt, hash, active: true, notes: clean(body.notes, 2000), createdAt: new Date().toISOString(), createdBy: 'admin'
  };
  db.users.push(u);
  save();
  return { client: clientSummary(u) };
});

route('PUT', '/api/admin/clients/:id', 'admin', ({ body, params }) => {
  const u = getUser(params.id);
  if (!u || u.role !== 'client') fail(404, 'Klients nav atrasts.');
  if (body.username !== undefined) { const un = clean(body.username, 64).toLowerCase(); validateUsername(un, u.id); u.username = un; }
  if (body.name !== undefined) { const n = clean(body.name, 80); if (n.length < 2) fail(400, 'Lūdzu ievadi vārdu.'); u.name = n; }
  if (body.phone !== undefined) u.phone = clean(body.phone, 40);
  if (body.email !== undefined) u.email = clean(body.email, 120);
  if (body.notes !== undefined) u.notes = clean(body.notes, 2000);
  if (body.active !== undefined) {
    u.active = !!body.active;
    if (!u.active) db.sessions = db.sessions.filter(s => s.userId !== u.id);
  }
  if (body.password) { validatePassword(body.password); Object.assign(u, U.hashPassword(body.password)); db.sessions = db.sessions.filter(s => s.userId !== u.id); }
  save();
  return { client: clientSummary(u) };
});

route('DELETE', '/api/admin/clients/:id', 'admin', ({ params }) => {
  const u = getUser(params.id);
  if (!u || u.role !== 'client') fail(404, 'Klients nav atrasts.');
  // nākotnes pieraksti tiek atcelti, vēsture saglabājas statistikai
  for (const b of db.bookings) if (b.userId === u.id) {
    b.guestName = u.name; b.guestPhone = u.phone; b.userId = null;
    if (b.status === 'booked' && b.date >= U.today()) { b.status = 'cancelled'; b.cancelledBy = 'admin'; }
  }
  db.users = db.users.filter(x => x.id !== u.id);
  db.sessions = db.sessions.filter(s => s.userId !== u.id);
  save();
  return { ok: true };
});

function serviceInput(body, svc = {}) {
  const name = clean(body.name ?? svc.name, 80);
  if (name.length < 2) fail(400, 'Lūdzu ievadi pakalpojuma nosaukumu.');
  return {
    name, description: clean(body.description ?? svc.description, 300),
    duration: num(body.duration ?? svc.duration, 5, 720, 60),
    price: num(body.price ?? svc.price, 0, 100000, 0),
    active: body.active === undefined ? svc.active !== false : !!body.active,
    color: /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : (svc.color || store.SERVICE_COLORS[db.services.length % store.SERVICE_COLORS.length]),
    order: num(body.order ?? svc.order, 0, 999, db.services.length)
  };
}
route('GET', '/api/admin/services', 'admin', () => ({ services: [...db.services].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) }));
route('POST', '/api/admin/services', 'admin', ({ body }) => { const s = { id: U.uid('svc'), ...serviceInput(body) }; db.services.push(s); save(); return { service: s }; });
route('PUT', '/api/admin/services/:id', 'admin', ({ body, params }) => {
  const s = getService(params.id); if (!s) fail(404, 'Pakalpojums nav atrasts.');
  Object.assign(s, serviceInput(body, s));
  for (const b of db.bookings) if (b.serviceId === s.id && b.status === 'booked') b.serviceName = s.name;
  save(); return { service: s };
});
route('DELETE', '/api/admin/services/:id', 'admin', ({ params }) => {
  const i = db.services.findIndex(x => x.id === params.id); if (i < 0) fail(404, 'Pakalpojums nav atrasts.');
  db.services.splice(i, 1); save(); return { ok: true };
});

route('GET', '/api/admin/schedule', 'admin', () => ({ hours: db.hours, closures: [...db.closures].sort((a, b) => a.date.localeCompare(b.date)) }));
route('PUT', '/api/admin/hours', 'admin', ({ body }) => {
  const next = {};
  for (let d = 0; d < 7; d++) {
    const h = body.hours?.[d] || body.hours?.[String(d)];
    if (!h) fail(400, 'Trūkst darba laika dati.');
    const open = !!h.open;
    if (!U.isTime(h.start) || !U.isTime(h.end)) fail(400, 'Nederīgs darba laiks.');
    if (open && U.toMin(h.end) <= U.toMin(h.start)) fail(400, 'Darba dienas beigām jābūt pēc sākuma.');
    const hasBreak = U.isTime(h.breakStart) && U.isTime(h.breakEnd);
    if (hasBreak && U.toMin(h.breakEnd) <= U.toMin(h.breakStart)) fail(400, 'Pārtraukuma beigām jābūt pēc sākuma.');
    next[d] = { open, start: h.start, end: h.end, breakStart: hasBreak ? h.breakStart : '', breakEnd: hasBreak ? h.breakEnd : '' };
  }
  db.hours = next; save(); return { hours: db.hours };
});
route('POST', '/api/admin/closures', 'admin', ({ body }) => {
  const from = body.from, to = body.to || body.from;
  if (!U.isDate(from) || !U.isDate(to) || to < from) fail(400, 'Nederīgs datums.');
  const added = [];
  for (let d = from, i = 0; d <= to && i < 366; d = U.addDays(d, 1), i++) {
    if (db.closures.some(c => c.date === d)) continue;
    const c = { id: U.uid('cls'), date: d, reason: clean(body.reason, 120) };
    db.closures.push(c); added.push(c);
  }
  save();
  const affected = db.bookings.filter(b => b.status === 'booked' && b.date >= from && b.date <= to).length;
  return { added, affected };
});
route('DELETE', '/api/admin/closures/:id', 'admin', ({ params }) => { db.closures = db.closures.filter(c => c.id !== params.id); save(); return { ok: true }; });

route('GET', '/api/admin/settings', 'admin', ({ user }) => ({ settings: db.settings, admin: publicUser(user) }));
route('PUT', '/api/admin/settings', 'admin', ({ body }) => {
  const s = db.settings, b = body || {};
  for (const k of ['salonName', 'tagline', 'address', 'phone', 'email', 'instagram']) if (b[k] !== undefined) s[k] = clean(b[k], 200);
  if (b.about !== undefined) s.about = clean(b.about, 2000);
  if (b.slotStep !== undefined) s.slotStep = [5, 10, 15, 20, 30, 60].includes(+b.slotStep) ? +b.slotStep : 15;
  if (b.minAdvanceHours !== undefined) s.minAdvanceHours = num(b.minAdvanceHours, 0, 168, 2);
  if (b.cancelHours !== undefined) s.cancelHours = num(b.cancelHours, 0, 168, 12);
  if (b.bookingDaysAhead !== undefined) s.bookingDaysAhead = num(b.bookingDaysAhead, 1, 365, 60);
  if (b.maxActiveBookings !== undefined) s.maxActiveBookings = num(b.maxActiveBookings, 1, 20, 3);
  if (b.allowRegistration !== undefined) s.allowRegistration = !!b.allowRegistration;
  save();
  return { settings: s };
});

route('GET', '/api/admin/export/bookings.csv', 'admin', ({ res }) => {
  const rows = [['Datums', 'Sākums', 'Beigas', 'Klients', 'Tālrunis', 'Pakalpojums', 'Cena EUR', 'Statuss', 'Piezīme']];
  const label = { booked: 'Pierakstīts', completed: 'Notika', cancelled: 'Atcelts', noshow: 'Neieradās' };
  for (const v of db.bookings.map(b => bookingView(b, true)).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)))
    rows.push([v.date, v.start, v.end, v.clientName, v.clientPhone, v.serviceName, String(v.price).replace('.', ','), label[v.status], v.note]);
  // aizsardzība pret formulu ievietošanu izklājlapā (=, +, -, @ šūnas sākumā); tālruņa numuri paliek neskarti
  const safe = v => { const t = String(v ?? ''); return /^[=+\-@\t\r]/.test(t) && !/^\+?[\d\s()-]+$/.test(t) ? "'" + t : t; };
  const csv = '\ufeff' + rows.map(r => r.map(c => `"${safe(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="pieraksti-${U.today()}.csv"` });
  res.end(csv);
  return undefined;
});

route('GET', '/api/admin/backup', 'admin', ({ res }) => {
  const copy = { ...db, sessions: [] };
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="frizetava-backup-${U.today()}.json"` });
  res.end(JSON.stringify(copy, null, 2));
  return undefined;
});

/* ------------------------------------------------------------------ server */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};
const PAGES = { '/': 'index.html', '/pieslegties': 'pieslegties.html', '/konts': 'konts.html', '/admin': 'admin.html' };

function serveStatic(req, res, pathname) {
  const rel = PAGES[pathname.replace(/\/$/, '') || '/'] || pathname.replace(/^\/+/, '');
  // Viena faila būvējumā (Railway Function) faili ir iebūvēti atmiņā
  if (typeof globalThis.__EMBEDDED_PUBLIC === 'object') {
    const content = Object.prototype.hasOwnProperty.call(globalThis.__EMBEDDED_PUBLIC, rel) ? globalThis.__EMBEDDED_PUBLIC[rel] : null;
    if (content == null) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><meta charset="utf-8"><title>Nav atrasts</title><p style="font-family:sans-serif;padding:40px">Lapa nav atrasta. <a href="/">Uz sākumu</a></p>');
    }
    const ext = path.extname(rel).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300' });
    return res.end(req.method === 'HEAD' ? undefined : content);
  }
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><meta charset="utf-8"><title>Nav atrasts</title><p style="font-family:sans-serif;padding:40px">Lapa nav atrasta. <a href="/">Uz sākumu</a></p>');
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300' });
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 1e6) { reject(new HttpError(413, 'Pārāk liels pieprasījums.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Nederīgi dati.')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  let url, pathname;
  try { url = new URL(req.url, 'http://localhost'); pathname = decodeURIComponent(url.pathname); } catch { pathname = null; }
  if (pathname == null || pathname.includes('\0')) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Nederīgs pieprasījums.'); }

  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, pathname);
  }

  const sendJson = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  try {
    let match = null;
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = pathname.match(r.re);
      if (m) { match = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]])) }; break; }
    }
    if (!match) fail(404, 'Nav atrasts.');
    if (req.method !== 'GET' && !(req.headers['content-type'] || '').includes('application/json')) fail(415, 'Nepieciešams JSON.');
    const user = sessionUser(req);
    const { access } = match.r;
    if (access && !user) fail(401, 'Lūdzu pieslēdzies.');
    if (access === 'admin' && user.role !== 'admin') fail(403, 'Nav piekļuves.');
    if (access === 'client' && user.role !== 'client') fail(403, 'Šī darbība pieejama tikai klientiem.');
    const body = req.method === 'GET' ? {} : await readBody(req);
    const out = await match.r.handler({ req, res, user, body, params: match.params, query: Object.fromEntries(url.searchParams) });
    if (out !== undefined) sendJson(200, out);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (!res.headersSent) sendJson(e.status || 500, { error: e instanceof HttpError ? e.message : 'Servera kļūda. Lūdzu mēģini vēlreiz.' });
  }
});

process.on('unhandledRejection', e => console.error('Neapstrādāta kļūda:', e));
server.listen(PORT, () => console.log(`  Frizētava darbojas: http://localhost:${PORT}`));
