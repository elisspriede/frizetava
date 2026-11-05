/* Pieteikšanās vizītei bez konta: pakalpojums → datums un laiks → vārds un tālrunis → (pēc izvēles) konta izveide */
'use strict';
(async () => {
  let info, me = null;
  try {
    [info, me] = await Promise.all([API.get('/api/public'), API.get('/api/me').then(r => r.user).catch(() => null)]);
  } catch (e) { return toast(e.message, 'error'); }
  if (me && me.role === 'client') return location.replace('/konts');

  const S = info.settings;
  const W = { step: 1, serviceId: null, month: null, date: null, start: null, name: '', phone: '', note: '', done: null };
  const svcById = id => info.services.find(s => s.id === id);
  const phoneHref = S.phone ? `tel:${S.phone.replace(/[^\d+]/g, '')}` : '';

  document.title = `Pieteikties vizītei — ${S.salonName}`;
  $('#brand').innerHTML = `${BRAND_MARK}<span>${esc(S.salonName)}</span>`;
  if (me && me.role === 'admin') { $('#loginLink').textContent = 'Admin panelis'; $('#loginLink').href = '/admin'; }

  // apstiprinājums un konta atslēgas saglabājas šīs cilnes sesijā (atsvaidzināšana tās nepazaudē)
  const store = {
    get(k, d) { try { const v = JSON.parse(sessionStorage.getItem(k) || 'null'); return v == null ? d : v; } catch { return d; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* privātais režīms */ } },
    del(...ks) { try { ks.forEach(k => sessionStorage.removeItem(k)); } catch { /* */ } }
  };
  let tokens = store.get('guestTokens', []).filter(t => t && t.exp > Date.now()).slice(-10);
  const saved = store.get('guestDone', null);
  if (saved && saved.booking) W.done = saved;
  const announce = msg => { const s = $('#wstatus'); if (s) { s.textContent = ''; setTimeout(() => { s.textContent = msg; }, 30); } };

  // pakalpojuma priekšizvēle no saites (?pakalpojums=…)
  const pre = new URLSearchParams(location.search).get('pakalpojums');
  if (pre && svcById(pre) && !W.done) { W.serviceId = pre; W.step = 2; }

  /* ------------------------------------------------ sānu kartītes */
  function renderInfo() {
    const order = [1, 2, 3, 4, 5, 6, 0];
    const wd = new Date().getDay();
    $('#info').innerHTML = `
      <div class="card-head"><h3>Kontakti</h3></div>
      <div style="display:grid;gap:12px;font-size:14px">
        ${S.address ? `<div style="display:flex;gap:10px;align-items:center">${icon('pin', 'style="width:18px;height:18px;color:var(--secondary)"')}<span>${esc(S.address)}</span></div>` : ''}
        ${S.phone ? `<a href="${esc(phoneHref)}" style="display:flex;gap:10px;align-items:center;text-decoration:none">${icon('phone', 'style="width:18px;height:18px;color:var(--secondary)"')}<b>${esc(S.phone)}</b></a>` : ''}
      </div>
      <div style="margin-top:18px;display:grid;gap:4px;font-size:13.5px">${order.map(d => {
        const h = info.hours[d];
        return `<div style="display:flex;justify-content:space-between;${d === wd ? 'font-weight:700;color:var(--primary)' : 'color:var(--ink-2)'}"><span>${cap(LV.days[d])}</span><span>${h && h.open ? `${h.start}–${h.end}` : 'Slēgts'}</span></div>`;
      }).join('')}</div>
      <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
      <p class="small muted">Jau ir konts? <a href="/pieslegties" style="color:var(--accent);font-weight:600">Pieslēdzies</a>, lai redzētu un pārvaldītu savus pierakstus.</p>`;
  }

  function renderSummary() {
    const svc = svcById(W.serviceId);
    const row = (k, v, on) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px dashed rgba(255,255,255,.16)"><span style="opacity:.65">${k}</span><b style="text-align:right;${on ? '' : 'opacity:.45;font-weight:500'}">${v}</b></div>`;
    $('#summary').innerHTML = `<span class="eyebrow" style="color:var(--tertiary)">Tavs pieraksts</span>
      <div style="margin-top:12px;position:relative;z-index:1">
        ${row('Pakalpojums', svc ? esc(svc.name) : 'nav izvēlēts', !!svc)}
        ${row('Datums', W.date ? fmt.dateLong(W.date) : '—', !!W.date)}
        ${row('Laiks', W.start && svc ? `${W.start} – ${fromMin(toMin(W.start) + svc.duration)}` : '—', !!W.start)}
        <div style="display:flex;justify-content:space-between;padding-top:14px;font-size:18px"><span style="opacity:.65">Cena</span><b>${svc ? fmt.money(svc.price) : '—'}</b></div>
      </div>`;
  }

  /* ------------------------------------------------ vednis */
  function stepsBar() {
    return `<div class="steps">${['Pakalpojums', 'Datums un laiks', 'Tavi dati'].map((l, i) => {
      const n = i + 1, cls = n === W.step ? 'on' : n < W.step ? 'done' : '';
      return `<span class="step ${cls}" data-goto="${n}" ${n < W.step ? 'role="button" tabindex="0"' : ''}><i>${n < W.step ? '✓' : n}</i>${l}</span>`;
    }).join('')}</div>`;
  }

  function render(focus = false) {
    renderSummary();
    const el = $('#wizard');
    if (S.allowGuestBooking === false) {
      el.innerHTML = `<div class="empty" style="padding:40px 10px">${icon('calendar')}<p style="font-size:16px;color:var(--ink)">Pieteikšanās bez konta šobrīd nav pieejama.</p>
        <p style="margin-top:8px">Lūdzu <a href="/pieslegties" style="color:var(--accent);font-weight:600">pieslēdzies savam kontam</a>${S.phone ? ` vai zvani <a href="${esc(phoneHref)}" style="font-weight:600">${esc(S.phone)}</a>` : ''}.</p></div>`;
      return;
    }
    if (W.done) { renderDone(); if (focus) { $('#wstep').focus({ preventScroll: true }); announce('Pieraksts apstiprināts'); } return; }
    const title = ['Izvēlies pakalpojumu', 'Izvēlies laiku', 'Tavi dati'][W.step - 1];
    el.innerHTML = `<div class="card-head"><div><span class="eyebrow">Bez reģistrācijas</span><h3 id="wstep" tabindex="-1" style="margin-top:6px;font-size:22px;outline:none">${title}</h3></div></div>` + stepsBar() + '<div id="wbody"></div>';
    if (focus) { $('#wstep').focus({ preventScroll: true }); announce(`${W.step}. solis no 3: ${title}`); }
    $$('.step.done', el).forEach(s => {
      const go = () => { W.step = +s.dataset.goto; render(true); };
      s.addEventListener('click', go);
      s.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
    if (W.step === 1) renderServices();
    if (W.step === 2) renderDateTime();
    if (W.step === 3) renderDetails();
  }

  function renderServices() {
    $('#wbody').innerHTML = info.services.length ? `<div class="svc-pick">${info.services.map(s => `
      <button type="button" class="svc-opt ${W.serviceId === s.id ? 'on' : ''}" data-svc="${s.id}">
        <span style="display:flex;align-items:center;gap:8px"><i class="dot" style="background:${esc(s.color)}"></i><b>${esc(s.name)}</b></span>
        <span>${fmt.dur(s.duration)}${s.description ? ' · ' + esc(s.description) : ''}</span><span class="p">${fmt.money(s.price)}</span>
      </button>`).join('')}</div>` : '<p class="muted">Pakalpojumi drīzumā.</p>';
    $$('[data-svc]').forEach(b => b.addEventListener('click', () => {
      if (W.serviceId !== b.dataset.svc) { W.date = null; W.start = null; }
      W.serviceId = b.dataset.svc; W.step = 2;
      render(true);
      $('#wizard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }

  function renderDateTime() {
    $('#wbody').innerHTML = `<div id="picker"></div>
      <div class="modal-foot" style="justify-content:space-between">
        <button type="button" class="btn btn-line" id="back">Atpakaļ</button>
        <button type="button" class="btn" id="next" ${W.start ? '' : 'disabled'}>Turpināt ${icon('arrowR')}</button></div>`;
    $('#back').addEventListener('click', () => { W.step = 1; render(true); });
    $('#next').addEventListener('click', () => { if (W.start) { W.step = 3; render(true); } });
    createDateTimePicker($('#picker'), {
      service: svcById(W.serviceId), daysAhead: S.bookingDaysAhead, month: W.month, date: W.date, start: W.start, announce,
      onChange: v => { W.date = v.date; W.start = v.start; W.month = v.month; const n = $('#next'); if (n) n.disabled = !v.start; renderSummary(); }
    });
  }

  function renderDetails() {
    $('#wbody').innerHTML = `<form id="details" class="form-grid" novalidate>
        <label class="field"><span>Vārds, uzvārds</span><input class="input" name="name" autocomplete="name" maxlength="80" required value="${esc(W.name)}"></label>
        <label class="field"><span>Tālrunis</span><input class="input" name="phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="40" placeholder="+371 2…" required value="${esc(W.phone)}"></label>
        <label class="field full"><span>Komentārs <span class="muted">(nav obligāts)</span></span>
          <textarea class="input" name="note" maxlength="500" placeholder="Piem., vēlos apspriest jaunu krāsu…">${esc(W.note)}</textarea></label>
        <label class="hp" aria-hidden="true">Mājaslapa <input name="website" tabindex="-1" autocomplete="off"></label>
        <p class="full small muted">Tavu vārdu un tālruni izmantosim tikai šī pieraksta pārvaldībai — lai sazinātos, ja kas mainās.</p>
        <div class="alert full hidden" id="detErr" role="alert"></div>
        <div class="full modal-foot" style="justify-content:space-between;margin-top:4px">
          <button type="button" class="btn btn-line" id="back">Atpakaļ</button>
          <button type="submit" class="btn btn-lg btn-accent">Apstiprināt pierakstu</button></div>
      </form>`;
    const f = $('#details');
    $('#back').addEventListener('click', () => { W.step = 2; render(true); });
    f.addEventListener('input', () => { W.name = f.name.value; W.phone = f.phone.value; W.note = f.note.value; });
    setTimeout(() => (W.name ? f.phone : f.name).focus(), 50);
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('#detErr'); err.classList.add('hidden');
      const d = formData(f);
      const bad = d.name.trim().length < 2 ? 'Lūdzu ievadi savu vārdu.' : d.phone.replace(/\D/g, '').length < 8 ? 'Lūdzu ievadi derīgu tālruņa numuru.' : '';
      if (bad) { err.textContent = bad; err.classList.remove('hidden'); (d.name.trim().length < 2 ? f.name : f.phone).focus(); return; }
      if (!W.date || !W.start) { toast('Lūdzu izvēlies laiku.', 'error'); W.step = 2; render(true); return; }
      await withBusy(e.submitter, async () => {
        try {
          const r = await API.post('/api/guest/bookings', { serviceId: W.serviceId, date: W.date, start: W.start, name: d.name, phone: d.phone, note: d.note, website: d.website });
          if (r.claimToken) { tokens.push({ t: r.claimToken, exp: Date.now() + 2 * 3600e3 - 60e3 }); tokens = tokens.slice(-10); store.set('guestTokens', tokens); }
          W.done = { booking: r.booking, name: r.name, phone: r.phone, hasToken: !!r.claimToken };
          store.set('guestDone', W.done);
          render(true);
          $('#wizard').scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (x) {
          if (x.status === 409 && /laiks/.test(x.message)) { toast(x.message, 'error'); W.start = null; W.step = 2; render(true); return; }
          err.textContent = x.message; err.classList.remove('hidden');
        }
      });
    });
  }

  /* ------------------------------------------------ apstiprinājums + konta piedāvājums */
  function renderDone() {
    const { booking: b, name } = W.done;
    const live = tokens.filter(t => t.exp > Date.now());
    $('#wizard').innerHTML = `<div style="text-align:center;padding:16px 6px 4px">
        <div style="width:72px;height:72px;border-radius:50%;margin:0 auto 18px;display:grid;place-items:center;background:var(--ok-bg);color:var(--ok)">${icon('check', 'style="width:34px;height:34px"')}</div>
        <span class="eyebrow">Pieraksts apstiprināts</span>
        <h2 id="wstep" tabindex="-1" style="font-size:clamp(24px,3.4vw,30px);margin:10px 0 6px;letter-spacing:-.03em;outline:none">${fmt.dateLong(b.date)}, ${b.start}</h2>
        <p class="muted">${esc(b.serviceName)} · ${fmt.money(b.price)}</p>
        ${S.address ? `<p class="muted small" style="margin-top:4px">${esc(S.address)}</p>` : ''}
        <p class="small" style="margin-top:14px;color:var(--ink-2)">Paldies, ${esc(name.split(' ')[0])}! Ja vajadzēs pārcelt vai atcelt${S.phone ? `, zvani <a href="${esc(phoneHref)}" style="font-weight:600">${esc(S.phone)}</a>` : ', sazinies ar salonu'}.</p>
      </div>
      <div id="claim"></div>`;
    renderClaim(W.done.hasToken && live.length ? live : null);
  }

  function renderClaim(live) {
    const box = $('#claim');
    const again = `<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:22px">
        <button type="button" class="btn btn-line" id="again">${icon('plus')} Vēl viens pieraksts</button><a class="btn btn-ghost" href="/">Uz sākumlapu</a></div>`;
    const bindAgain = () => $('#again').addEventListener('click', () => {
      store.del('guestDone'); // atslēgas paliek — nākamais pieraksts arī varēs tikt piesaistīts kontam
      Object.assign(W, { step: 1, serviceId: null, date: null, start: null, note: '', month: null, name: W.done.name || W.name, phone: W.done.phone || W.phone, done: null });
      render(true);
    });
    if (!live || !S.allowRegistration || me) { box.innerHTML = again; bindAgain(); return; }

    box.innerHTML = `<div class="summary" style="margin-top:22px;text-align:left;gap:14px">
        <div style="display:block"><span class="eyebrow">Ieteikums</span>
          <h3 style="font-size:19px;margin-top:6px">Izveido savu kontu — tikai lietotājvārds un parole</h3>
          ${live.length > 1 ? `<p class="small" style="margin-top:6px;color:var(--ink-2)">Kontam tiks piesaistīti visi ${live.length} šodien veiktie pieraksti.</p>` : ''}
          <ul style="margin:10px 0 0;padding-left:18px;color:var(--ink-2);font-size:14px;line-height:1.7">
            <li>redzēsi visus savus pierakstus vienuviet;</li>
            <li>varēsi pats pārcelt vai atcelt vizīti;</li>
            <li>nākamreiz pieteiksies ātrāk — dati jau būs saglabāti.</li></ul></div>
        <form id="claimForm" class="form-grid" style="display:grid" autocomplete="on">
          <label class="field"><span>Lietotājvārds</span><input class="input" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${esc(slugUsername(W.done.name))}"></label>
          <label class="field"><span>Parole <span class="muted">(vismaz 6 simboli)</span></span>
            <div class="input-group"><input class="input" type="password" name="password" autocomplete="new-password" minlength="6" required>
            <button type="button" class="icon-btn" data-toggle-pass aria-label="Rādīt paroli">${icon('eye')}</button></div></label>
          <label class="field full"><span>E-pasts <span class="muted">(nav obligāts)</span></span><input class="input" type="email" name="email" autocomplete="email"></label>
          <div class="alert full hidden" id="claimErr" role="alert"></div>
          <div class="full" style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end">
            <button type="button" class="btn btn-line" id="noThanks">Nē, paldies</button>
            <button type="submit" class="btn">Izveidot kontu</button></div>
        </form>
        <p class="tiny muted" style="display:block">Vārds un tālrunis tiks ņemti no pieraksta, un pieraksts uzreiz parādīsies tavā kontā.</p>
      </div>`;
    passwordToggle(box);
    $('#noThanks').addEventListener('click', () => { store.set('guestDone', { ...W.done, hasToken: false }); W.done.hasToken = false; box.innerHTML = again; bindAgain(); $('#again').focus(); });
    $('#claimForm').addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('#claimErr'); err.classList.add('hidden');
      const f = e.target;
      if (!f.reportValidity()) return;
      await withBusy(e.submitter, async () => {
        try {
          await API.post('/api/guest/claim', { tokens: live.map(t => t.t), ...formData(f) });
          store.del('guestDone', 'guestTokens');
          toast('Konts izveidots!');
          location.href = '/konts';
        } catch (x) {
          err.textContent = x.message; err.classList.remove('hidden');
          if (x.status === 410) { store.del('guestTokens'); tokens = []; W.done.hasToken = false; store.set('guestDone', W.done); setTimeout(() => { box.innerHTML = again; bindAgain(); }, 2500); }
        }
      });
    });
  }

  renderInfo();
  render();
})();
