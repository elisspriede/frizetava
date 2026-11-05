/* Kopīgās palīgfunkcijas: API, formatēšana, ikonas, paziņojumi, modāļi */
'use strict';

const API = {
  async req(method, url, body) {
    const opt = { method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    let r;
    try { r = await fetch(url, opt); } catch { throw new Error('Nav savienojuma ar serveri.'); }
    let data = null;
    try { data = await r.json(); } catch { /* tukšs */ }
    if (!r.ok) {
      const e = new Error((data && data.error) || 'Radās kļūda.');
      e.status = r.status;
      if (r.status === 401 && !url.includes('/api/login')) { location.href = '/pieslegties'; }
      throw e;
    }
    return data;
  },
  get(u) { return this.req('GET', u); },
  post(u, b = {}) { return this.req('POST', u, b); },
  put(u, b = {}) { return this.req('PUT', u, b); },
  del(u) { return this.req('DELETE', u, {}); }
};

/* ---------- formatēšana (latviski) ---------- */
const LV = {
  months: ['janvāris', 'februāris', 'marts', 'aprīlis', 'maijs', 'jūnijs', 'jūlijs', 'augusts', 'septembris', 'oktobris', 'novembris', 'decembris'],
  monthsShort: ['janv.', 'febr.', 'marts', 'apr.', 'maijs', 'jūn.', 'jūl.', 'aug.', 'sept.', 'okt.', 'nov.', 'dec.'],
  days: ['svētdiena', 'pirmdiena', 'otrdiena', 'trešdiena', 'ceturtdiena', 'piektdiena', 'sestdiena'],
  daysShort: ['Sv', 'P', 'O', 'T', 'C', 'Pk', 'S'],
  status: { booked: 'Pierakstīts', completed: 'Notika', cancelled: 'Atcelts', noshow: 'Neieradās' }
};
const pad = n => String(n).padStart(2, '0');
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => dateStr(new Date());
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return dateStr(d); };
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

const fmt = {
  money: n => new Intl.NumberFormat('lv-LV', { style: 'currency', currency: 'EUR', maximumFractionDigits: Number(n) % 1 ? 2 : 0 }).format(Number(n) || 0),
  num: n => new Intl.NumberFormat('lv-LV').format(n),
  date: s => { const d = parseD(s); return `${d.getDate()}. ${LV.months[d.getMonth()]}`; },
  dateShort: s => { const d = parseD(s); return `${d.getDate()}. ${LV.monthsShort[d.getMonth()]}`; },
  dateLong: s => { const d = parseD(s); return `${cap(LV.days[d.getDay()])}, ${d.getDate()}. ${LV.months[d.getMonth()]}`; },
  dateFull: s => { const d = parseD(s); return `${d.getDate()}.${pad(d.getMonth() + 1)}.${d.getFullYear()}.`; },
  relDay: s => {
    const t = todayStr();
    if (s === t) return 'Šodien';
    if (s === addDays(t, 1)) return 'Rīt';
    if (s === addDays(t, -1)) return 'Vakar';
    return fmt.dateLong(s);
  },
  dur: m => m < 60 ? `${m} min` : (m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`),
  initials: name => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------- ikonas (līniju stils) ---------- */
const ICONS = {
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="17" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1.2-3.5 3.6-5 6.5-5s5.3 1.5 6.5 5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2 .6 3.2 2.2 3.8 5"/>',
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  chevL: '<path d="m15 18-6-6 6-6"/>',
  chevR: '<path d="m9 18 6-6-6-6"/>',
  arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m22 7-10 6L2 7"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  euro: '<path d="M4 10h12M4 14h9M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2"/>',
  trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  pie: '<path d="M21.2 15.9A10 10 0 1 1 8 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10Z"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.9 4.2A10 10 0 0 1 12 4c6.5 0 10 8 10 8a17 17 0 0 1-2.2 3.2M6.6 6.6A17 17 0 0 0 2 12s3.5 8 10 8a9.7 9.7 0 0 0 5.4-1.6M2 2l20 20"/><path d="M14.1 14.1a3 3 0 0 1-4.2-4.2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z"/><path d="M2 21c0-3 1.9-5.4 5.2-6.1 2.5-.5 5-1.6 6.8-3.9"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  insta: '<rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".5"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  home: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M9 22V12h6v10"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>'
};
const icon = (name, attrs = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${attrs}>${ICONS[name] || ''}</svg>`;
const BRAND_MARK = `<span class="brand-mark">${icon('scissors')}</span>`;

/* ---------- toast ---------- */
function toast(msg, type = 'ok') {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'error' ? ' error' : '');
  t.innerHTML = icon(type === 'error' ? 'alert' : 'check') + `<span>${esc(msg)}</span>`;
  box.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, type === 'error' ? 4500 : 3000);
}

/* ---------- modālis ---------- */
function openModal({ title, subtitle = '', body = '', foot = '', wide = false, onOpen }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><div><h3>${esc(title)}</h3>${subtitle ? `<p class="muted small" style="margin-top:4px">${subtitle}</p>` : ''}</div>
    <button class="icon-btn" data-close aria-label="Aizvērt">${icon('x')}</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  const prevFocus = document.activeElement;
  const close = () => {
    wrap.classList.add('out');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => { wrap.remove(); if (prevFocus && prevFocus.focus) prevFocus.focus(); }, 180);
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  const m = $('.modal', wrap);
  const first = $('input:not([type=hidden]), select, textarea', m);
  setTimeout(() => (first || $('[data-close]', m)).focus(), 50);
  if (onOpen) onOpen(m, close);
  return { el: m, close };
}

function confirmDialog(text, { title = 'Vai tiešām?', ok = 'Apstiprināt', danger = false } = {}) {
  return new Promise(resolve => {
    let done = false;
    const { el, close } = openModal({
      title, body: `<p class="muted">${text}</p>`,
      foot: `<button class="btn btn-line" data-close>Atpakaļ</button><button class="btn ${danger ? 'btn-accent' : ''}" data-ok>${esc(ok)}</button>`
    });
    $('[data-ok]', el).addEventListener('click', () => { done = true; resolve(true); close(); });
    const obs = new MutationObserver(() => { if (!document.body.contains(el)) { obs.disconnect(); if (!done) resolve(false); } });
    obs.observe(document.body, { childList: true });
  });
}

/* ---------- pogas ielāde ---------- */
async function withBusy(btn, fn) {
  if (!btn) return fn();
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = html; }
}

function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  }
  return o;
}

function sceneHTML() {
  return '<div class="scene" aria-hidden="true"><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div><div class="blob b4"></div></div>';
}
document.addEventListener('DOMContentLoaded', () => {
  if (!$('.scene')) document.body.insertAdjacentHTML('afterbegin', sceneHTML());
});

async function logout() {
  try { await API.post('/api/logout'); } catch { /* ignorē */ }
  location.href = '/';
}

function passwordToggle(root = document) {
  $$('[data-toggle-pass]', root).forEach(b => b.addEventListener('click', () => {
    const inp = b.parentElement.querySelector('input');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    b.innerHTML = icon(show ? 'eyeOff' : 'eye');
  }));
}

function genPassword(len = 10) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = new Uint32Array(len); crypto.getRandomValues(a);
  return [...a].map(n => chars[n % chars.length]).join('');
}
function slugUsername(name) {
  const s = (name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
  return s.slice(0, 24);
}
