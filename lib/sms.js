'use strict';
/*
 * SMS paziņojumi: klientam (apstiprinājums, pārcelšana, atcelšana, atgādinājums) un salonam (jauns / pārcelts / atcelts).
 * Pakalpojums (provider) ir nomaināms: 'sendberry' (Latvija), 'twilio', 'smsapi' vai 'log' (testa režīms — neko nesūta, tikai ieraksta žurnālā).
 * Sūtīšana notiek fonā rindā, tā nekad neaiztur lapas atbildi un nekad nesabojā pierakstu, ja SMS neizdodas.
 */
const U = require('./util');

const PROVIDERS = ['sendberry', 'twilio', 'smsapi', 'log'];
const SECRET_KEYS = ['sendberryKey', 'sendberryName', 'sendberryPassword', 'twilioSid', 'twilioToken', 'smsapiToken'];

function defaults() {
  return {
    provider: '',            // '' = izslēgts
    sender: 'LDStudio',      // sūtītāja vārds (ja pakalpojums to atļauj) vai numurs
    ascii: true,             // bez garumzīmēm: 160 zīmes vienā SMS, nevis 70
    ownerPhone: '',          // frizieres mobilais paziņojumiem
    owner: { onNew: true, onChange: true, onCancel: true },
    client: { confirm: true, change: true, cancel: true, reminder: true, reminderHours: 24, onAdminChanges: true },
    creds: { sendberryKey: '', sendberryName: '', sendberryPassword: '', twilioSid: '', twilioToken: '', smsapiToken: '' }
  };
}

/* ------------------------------------------------------------ teksts */
const LV_MAP = { ā: 'a', č: 'c', ē: 'e', ģ: 'g', ī: 'i', ķ: 'k', ļ: 'l', ņ: 'n', š: 's', ū: 'u', ž: 'z', Ā: 'A', Č: 'C', Ē: 'E', Ģ: 'G', Ī: 'I', Ķ: 'K', Ļ: 'L', Ņ: 'N', Š: 'S', Ū: 'U', Ž: 'Z' };
function toAscii(s) {
  return String(s)
    .replace(/[āčēģīķļņšūžĀČĒĢĪĶĻŅŠŪŽ]/g, ch => LV_MAP[ch])
    .replace(/[–—]/g, '-').replace(/[„“”«»]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E\n]/g, '');
}
// GSM-7 pamata alfabēts (vienkāršots: ASCII drukājamās zīmes bez dažām, kas aizņem 2 vietas)
const GSM_EXT = /[\^{}\\[~\]|€]/g;
function segments(text) {
  const gsm = /^[\x20-\x7E\n£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà€]*$/.test(text);
  if (gsm) { const len = text.length + (text.match(GSM_EXT) || []).length; return len <= 160 ? 1 : Math.ceil(len / 153); }
  const len = [...text].length;
  return len <= 70 ? 1 : Math.ceil(len / 67);
}

/* ------------------------------------------------------------ tālruņa numurs → E.164 */
function toE164(raw) {
  const s = String(raw || '').trim();
  let d = s.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  else if (!s.startsWith('+')) {
    if (/^2\d{7}$/.test(d)) return '+371' + d;          // Latvijas mobilais bez valsts koda
    if (/^02\d{7}$/.test(d)) return '+371' + d.slice(1);
    if (!/^371\d{8}$/.test(d)) return null;              // nezināms formāts — nesūtām
  }
  if (/^3710\d{8}$/.test(d)) d = '371' + d.slice(4);
  if (/^371/.test(d)) return /^3712\d{7}$/.test(d) ? '+' + d : null; // LV: SMS tikai uz mobilajiem (2x)
  return d.length >= 8 && d.length <= 15 ? '+' + d : null;
}
const maskPhone = p => (p ? p.slice(0, 5) + '•••' + p.slice(-3) : '');

/* ------------------------------------------------------------ pakalpojumi */
async function httpJson(url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* ne JSON */ }
    return { status: r.status, ok: r.ok, json, text: text.slice(0, 500) };
  } finally { clearTimeout(t); }
}

const SEND = {
  // Sendberry (SIA Think Intermedia, Rīga). Formāts kā Symfony sendberry-notifier: JSON POST, atbildē status "ok".
  async sendberry(cfg, to, body) {
    const { sendberryKey: key, sendberryName: name, sendberryPassword: password } = cfg.creds;
    if (!key || !name || !password) throw new Error('Nav ievadīta Sendberry API atslēga, lietotājvārds vai parole.');
    const r = await httpJson(process.env.SENDBERRY_API_URL || 'https://api.sendberry.com/SMS/SEND', { // URL maiņa — tikai testiem
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ key, name, password, from: cfg.sender, to: [to], content: body })
    });
    if (r.status === 200 && r.json && r.json.status === 'ok') return { id: r.json.ID || null };
    const m = r.json && r.json.message;
    throw new Error('Sendberry: ' + (Array.isArray(m) ? m.join('; ') : (m || `HTTP ${r.status}`)));
  },
  async twilio(cfg, to, body) {
    const { twilioSid: sid, twilioToken: token } = cfg.creds;
    if (!sid || !token) throw new Error('Nav ievadīts Twilio Account SID vai Auth Token.');
    const r = await httpJson(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: cfg.sender, Body: body }).toString()
    });
    if (r.ok && r.json && r.json.sid) return { id: r.json.sid };
    throw new Error((r.json && (r.json.message || r.json.code)) || `Twilio kļūda (HTTP ${r.status})`);
  },
  async smsapi(cfg, to, body) {
    const token = cfg.creds.smsapiToken;
    if (!token) throw new Error('Nav ievadīts SMSAPI tokens.');
    const params = { to: to.replace(/^\+/, ''), message: body, format: 'json', encoding: 'utf-8' };
    if (cfg.sender) params.from = cfg.sender;
    const r = await httpJson('https://api.smsapi.com/sms.do', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString()
    });
    if (r.ok && r.json && !r.json.error && Array.isArray(r.json.list)) return { id: r.json.list[0] && r.json.list[0].id };
    throw new Error((r.json && (r.json.message || r.json.error)) ? `SMSAPI: ${r.json.message || ''} (${r.json.error || r.status})` : `SMSAPI kļūda (HTTP ${r.status})`);
  },
  async log() { return { id: 'test-' + Date.now() }; }
};

/* ------------------------------------------------------------ dzinējs */
function createSms({ getDb, save }) {
  const cfg = () => {
    const db = getDb();
    const d = defaults();
    const s = db.settings.sms || {};
    return { ...d, ...s, owner: { ...d.owner, ...(s.owner || {}) }, client: { ...d.client, ...(s.client || {}) }, creds: { ...d.creds, ...(s.creds || {}) } };
  };
  const enabled = () => PROVIDERS.includes(cfg().provider);

  function log(entry) {
    const db = getDb();
    if (!Array.isArray(db.smsLog)) db.smsLog = [];
    db.smsLog.push({ at: new Date().toISOString(), ...entry });
    if (db.smsLog.length > 300) db.smsLog.splice(0, db.smsLog.length - 300);
    save();
  }

  // viena rinda, ziņas sūta pēc kārtas ar nelielu atstarpi
  const queue = [];
  let busy = false;
  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const job = queue.shift();
      try { await deliver(job); } catch (e) { console.error('SMS rindas kļūda:', e.message); }
      await new Promise(r => setTimeout(r, 400));
    }
    busy = false;
  }

  async function deliver({ to, text, type, bookingId, attempt = 1, resolve }) {
    const c = cfg();
    const body = c.ascii ? toAscii(text) : text;
    const seg = segments(body);
    try {
      if (!PROVIDERS.includes(c.provider)) throw new Error('SMS pakalpojums nav izvēlēts.');
      const r = await SEND[c.provider](c, to, body);
      log({ type, to: maskPhone(to), status: c.provider === 'log' ? 'test' : 'sent', segments: seg, provider: c.provider, bookingId: bookingId || null, text: c.provider === 'log' ? body : undefined });
      if (resolve) resolve({ ok: true, id: r.id, segments: seg, text: body });
    } catch (e) {
      const msg = String(e && e.name === 'AbortError' ? 'Pakalpojums neatbildēja laikā.' : (e && e.message) || e).slice(0, 200);
      if (attempt < 2 && !resolve && !/nav ievadīts|nav izvēlēts/i.test(msg)) {
        setTimeout(() => { queue.push({ to, text, type, bookingId, attempt: attempt + 1 }); pump(); }, 30000);
        return;
      }
      log({ type, to: maskPhone(to), status: 'failed', error: msg, segments: seg, provider: c.provider, bookingId: bookingId || null });
      if (resolve) resolve({ ok: false, error: msg });
    }
  }

  function enqueue(phone, text, type, bookingId) {
    if (!enabled()) return false;
    const to = toE164(phone);
    if (!to) { log({ type, to: String(phone || '').slice(0, 4) + '…', status: 'skipped', error: 'Nederīgs vai nav mobilā tālruņa numurs.', bookingId }); return false; }
    queue.push({ to, text, type, bookingId });
    pump();
    return true;
  }

  // tiešā sūtīšana (testa poga): atgriež rezultātu
  function sendNow(phone, text, type = 'test') {
    const to = toE164(phone);
    if (!to) return Promise.resolve({ ok: false, error: 'Nederīgs mobilā tālruņa numurs (piem., +371 2xxxxxxx).' });
    return new Promise(resolve => { queue.unshift({ to, text, type, resolve }); pump(); });
  }

  return { cfg, enabled, enqueue, sendNow };
}

module.exports = { createSms, defaults, toAscii, toE164, segments, maskPhone, PROVIDERS, SECRET_KEYS };
