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
const letters = s => (String(s).match(/\p{L}/gu) || []).length;
// bez garumzīmēm, ja tas nezaudē burtus (piem., kirilicā rakstītu vārdu tad sūta, kā ir)
const smsBody = (text, ascii) => { if (!ascii) return text; const a = toAscii(text); return letters(a) === letters(text) ? a : text; };
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
const DEFAULT_COUNTRIES = ['371', '370', '372']; // LV, LT, EE — citām valstīm SMS nesūta (aizsardzība pret dārgiem numuriem)
function toE164(raw, allowed = DEFAULT_COUNTRIES) {
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
  if (!allowed.some(cc => d.startsWith(cc))) return null;
  return d.length >= 8 && d.length <= 15 ? '+' + d : null;
}
const maskPhone = p => (p ? p.slice(0, 5) + '•••' + p.slice(-3) : '');

/* ------------------------------------------------------------ pakalpojumi */
async function httpJson(url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    let r;
    try { r = await fetch(url, { ...opts, signal: ctrl.signal }); }
    catch (e) {
      const code = e && e.cause && e.cause.code;
      if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) e.retryable = true; // savienojums netika izveidots — droši atkārtot
      throw e; // taimauts / pārtraukts savienojums: nav zināms, vai SMS aizgāja — neatkārtojam
    }
    if (r.status === 429) { const e = new Error('Pakalpojums lūdz pagaidīt (429).'); e.retryable = true; throw e; }
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
const LIMITS = { hour: 60, day: 300 }; // kopējais drošības limits visām SMS (pret kļūdām un ļaunprātību)

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
    try { save(); } catch (e) { console.error('SMS žurnāla saglabāšana neizdevās:', e.message); }
  }
  function countSent(seg) {
    const db = getDb(), k = U.today().slice(0, 7); // vietējais mēnesis
    db.smsStats = db.smsStats || {};
    const st = db.smsStats[k] || (db.smsStats[k] = { messages: 0, segments: 0 });
    st.messages++; st.segments += seg;
  }
  const scrub = (msg, c) => { let m = String(msg); for (const v of Object.values(c.creds)) if (v && v.length >= 4) m = m.split(v).join('***'); return m; };

  // kopējais limits: slīdošie logi atmiņā
  const sentTimes = [];
  function underBudget() {
    const now = Date.now();
    while (sentTimes.length && now - sentTimes[0] > 24 * 3600e3) sentTimes.shift();
    const lastHour = sentTimes.filter(t => now - t < 3600e3).length;
    return lastHour < LIMITS.hour && sentTimes.length < LIMITS.day;
  }

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
    const body = smsBody(text, c.ascii);
    const seg = segments(body);
    let r;
    try {
      if (!PROVIDERS.includes(c.provider)) throw new Error('SMS pakalpojums nav izvēlēts.');
      r = await SEND[c.provider](c, to, body);
    } catch (e) {
      const aborted = e && e.name === 'AbortError';
      const msg = scrub(aborted ? 'Pakalpojums neatbildēja laikā — SMS, iespējams, tomēr nosūtīta.' : ((e && e.message) || e), c).slice(0, 200);
      if (e && e.retryable && attempt < 2 && !resolve) {
        setTimeout(() => { queue.push({ to, text, type, bookingId, attempt: attempt + 1 }); pump(); }, 30000);
        return;
      }
      log({ type, to: maskPhone(to), status: aborted ? 'unknown' : 'failed', error: msg, segments: seg, provider: c.provider, bookingId: bookingId || null });
      if (resolve) resolve({ ok: false, error: msg });
      return;
    }
    // nosūtīts — tālāk tikai pieraksti; to kļūdas vairs nevar izraisīt atkārtotu sūtīšanu
    if (c.provider !== 'log') { sentTimes.push(Date.now()); countSent(seg); }
    log({ type, to: maskPhone(to), status: c.provider === 'log' ? 'test' : 'sent', segments: seg, provider: c.provider, bookingId: bookingId || null, text: c.provider === 'log' ? body : undefined });
    if (resolve) resolve({ ok: true, id: r && r.id, segments: seg, text: body });
  }

  function enqueue(phone, text, type, bookingId) {
    if (!enabled()) return false;
    const to = toE164(phone);
    if (!to) { log({ type, to: String(phone || '').replace(/\D/g, '').slice(0, 4) + '…', status: 'skipped', error: 'Nederīgs numurs, nav mobilais vai valsts nav atļauta (LV, LT, EE).', bookingId }); return false; }
    if (cfg().provider !== 'log' && !underBudget()) { log({ type, to: maskPhone(to), status: 'skipped', error: `Sasniegts drošības limits (${LIMITS.hour} stundā / ${LIMITS.day} diennaktī).`, bookingId }); return false; }
    queue.push({ to, text, type, bookingId });
    pump();
    return true;
  }

  function sendNow(phone, text, type = 'test') {
    const to = toE164(phone);
    if (!to) return Promise.resolve({ ok: false, error: 'Nederīgs mobilā tālruņa numurs (piem., +371 2xxxxxxx).' });
    if (cfg().provider !== 'log' && !underBudget()) return Promise.resolve({ ok: false, error: 'Sasniegts SMS drošības limits.' });
    return new Promise(resolve => { queue.unshift({ to, text, type, resolve }); pump(); });
  }

  return { cfg, enabled, enqueue, sendNow };
}

module.exports = { createSms, defaults, toAscii, smsBody, toE164, segments, maskPhone, PROVIDERS, SECRET_KEYS, LIMITS };
