'use strict';
(async () => {
  let me, info, bookings = [];
  const W = { step: 1, serviceId: null, month: null, date: null, start: null, note: '', reschedule: null, days: {}, slots: null, done: null };

  try {
    const r = await API.get('/api/me');
    if (!r.user) return location.replace('/pieslegties');
    if (r.user.role === 'admin') return location.replace('/admin');
    me = r.user;
    info = await API.get('/api/public');
  } catch (e) { return toast(e.message, 'error'); }

  const S = info.settings;
  document.title = `Mans konts — ${S.salonName}`;
  $('#brand').innerHTML = `${BRAND_MARK}<span>${esc(S.salonName)}</span>`;
  $('#logoutBtn').innerHTML = icon('logout');
  $('#logoutBtn').addEventListener('click', logout);
  $('#profileBtn').addEventListener('click', openProfile);
  $('#today').textContent = fmt.dateLong(todayStr());
  $('#rules').textContent = `Pierakstu vari pārcelt vai atcelt līdz ${S.cancelHours} h pirms vizītes. Vēlāk — lūdzu zvani ${S.phone}.`;
  const renderMe = () => {
    $('#hello').textContent = me.name.split(' ')[0];
    $('#profileBtn').innerHTML = `${icon('user')}<span class="hide-sm">${esc(me.name)}</span>`;
  };
  renderMe();

  const svcById = id => info.services.find(s => s.id === id);

  /* -------------------------------------------------- pieraksti */
  async function loadBookings() {
    bookings = (await API.get('/api/my/bookings')).bookings;
    renderBookings();
  }

  const isFuture = b => b.status === 'booked' && (b.date > todayStr() || (b.date === todayStr() && toMin(b.end) > new Date().getHours() * 60 + new Date().getMinutes()));

  function bookingItem(b, actions = true) {
    const d = parseD(b.date);
    const acts = !actions ? `<span class="badge ${b.status}">${LV.status[b.status]}</span>` : b.canModify
      ? `<button class="btn btn-sm btn-line" data-move="${b.id}">Pārcelt</button><button class="btn btn-sm btn-danger" data-cancel="${b.id}">Atcelt</button>`
      : `<span class="small muted">Izmaiņas — pa tālruni</span>`;
    return `<div class="booking-item">
      <div class="date-tile"><small>${LV.monthsShort[d.getMonth()]}</small><b>${d.getDate()}</b></div>
      <div class="info"><b>${esc(b.serviceName)}</b><span>${cap(LV.days[d.getDay()])} · ${b.start}–${b.end} · ${fmt.money(b.price)}</span></div>
      <div class="acts">${acts}</div></div>`;
  }

  function renderBookings() {
    const up = bookings.filter(isFuture);
    const past = bookings.filter(b => !isFuture(b)).reverse();
    $('#upCount').textContent = up.length ? `${up.length} aktīvi` : '';
    $('#upcoming').innerHTML = up.length ? up.map(b => bookingItem(b)).join('')
      : `<div class="empty">${icon('calendar')}<p>Tev vēl nav neviena pieraksta.</p></div>`;
    $('#history').innerHTML = past.length ? past.slice(0, 6).map(b => bookingItem(b, false)).join('')
      : `<p class="muted small">Šeit redzēsi savus iepriekšējos apmeklējumus.</p>`;

    const n = up[0];
    $('#nextCard').innerHTML = n ? `
      <span class="eyebrow" style="color:var(--tertiary)">Nākamā vizīte</span>
      <div class="when">${['Šodien', 'Rīt'][[todayStr(), addDays(todayStr(), 1)].indexOf(n.date)] || fmt.date(n.date)}, ${n.start}</div>
      <p style="opacity:.8;text-transform:capitalize">${LV.days[parseD(n.date).getDay()]}</p>
      <p style="opacity:.8">${esc(n.serviceName)} · ${fmt.dur(toMin(n.end) - toMin(n.start))} · ${fmt.money(n.price)}</p>
      <p class="small" style="opacity:.6;margin-top:6px">${esc(S.address || '')}</p>
      <div class="row">${n.canModify ? `<button class="btn btn-sm btn-ghost" data-move="${n.id}">Pārcelt</button><button class="btn btn-sm btn-ghost" data-cancel="${n.id}">Atcelt</button>` : ''}
        ${S.phone ? `<a class="btn btn-sm btn-ghost" href="tel:${esc(S.phone.replace(/\s/g, ''))}">${icon('phone')} Zvanīt</a>` : ''}</div>`
      : `<span class="eyebrow" style="color:var(--tertiary)">Nākamā vizīte</span>
      <div class="when">Vēl nav ieplānota</div>
      <p style="opacity:.75">Izvēlies pakalpojumu un sev ērtu laiku — tas aizņems mazāk nekā minūti.</p>`;
  }

  document.addEventListener('click', async e => {
    const mv = e.target.closest('[data-move]'), cn = e.target.closest('[data-cancel]');
    if (mv) startReschedule(bookings.find(b => b.id === mv.dataset.move));
    if (cn) {
      const b = bookings.find(x => x.id === cn.dataset.cancel);
      const ok = await confirmDialog(`Atcelt <b>${esc(b.serviceName)}</b> — ${fmt.dateLong(b.date)}, plkst. ${b.start}?`, { title: 'Atcelt pierakstu?', ok: 'Jā, atcelt', danger: true });
      if (!ok) return;
      try { await API.post(`/api/my/bookings/${b.id}/cancel`); toast('Pieraksts atcelts.'); await loadBookings(); if (W.reschedule && W.reschedule.id === b.id) resetWizard(); }
      catch (x) { toast(x.message, 'error'); }
    }
  });

  /* -------------------------------------------------- vednis */
  function resetWizard() {
    Object.assign(W, { step: 1, serviceId: null, date: null, start: null, note: '', reschedule: null, slots: null, done: null });
    renderWizard();
  }
  function startReschedule(b) {
    Object.assign(W, { step: 2, serviceId: b.serviceId, date: null, start: null, reschedule: b, slots: null, done: null, month: b.date.slice(0, 7) });
    if (W.month < todayStr().slice(0, 7)) W.month = todayStr().slice(0, 7);
    renderWizard();
    $('#wizard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function stepsBar() {
    const labels = W.reschedule ? ['Pakalpojums', 'Jaunais laiks', 'Apstiprināt'] : ['Pakalpojums', 'Datums un laiks', 'Apstiprināt'];
    return `<div class="steps">${labels.map((l, i) => {
      const n = i + 1, cls = n === W.step ? 'on' : n < W.step && !(W.reschedule && n === 1) ? 'done' : '';
      return `<span class="step ${cls}" data-goto="${n}"><i>${n < W.step ? '✓' : n}</i>${l}</span>`;
    }).join('')}</div>`;
  }

  function renderWizard() {
    const el = $('#wizard');
    if (W.done) {
      const b = W.done;
      el.innerHTML = `<div style="text-align:center;padding:30px 10px">
        <div style="width:72px;height:72px;border-radius:50%;margin:0 auto 18px;display:grid;place-items:center;background:var(--ok-bg);color:var(--ok)">${icon('check', 'style="width:34px;height:34px"')}</div>
        <span class="eyebrow">${W.doneType === 'move' ? 'Pieraksts pārcelts' : 'Pieraksts apstiprināts'}</span>
        <h2 style="font-size:30px;margin:10px 0 6px;letter-spacing:-.03em">${fmt.dateLong(b.date)}, ${b.start}</h2>
        <p class="muted">${esc(b.serviceName)} · ${fmt.money(b.price)}</p>
        <p class="muted small" style="margin-top:4px">${esc(S.address || '')}</p>
        <button class="btn btn-lg" style="margin-top:26px" id="newBtn">${icon('plus')} Jauns pieraksts</button></div>`;
      $('#newBtn').addEventListener('click', resetWizard);
      return;
    }
    const head = W.reschedule
      ? `<div class="card-head"><div><span class="eyebrow">Pārcelt pierakstu</span><h3 style="margin-top:6px;font-size:22px">${esc(W.reschedule.serviceName)}</h3>
         <p class="muted small">Pašlaik: ${fmt.dateLong(W.reschedule.date)}, ${W.reschedule.start}</p></div><button class="btn btn-sm btn-line" id="abortMove">Atpakaļ</button></div>`
      : `<div class="card-head"><div><span class="eyebrow">Jauns pieraksts</span><h3 style="margin-top:6px;font-size:22px">Piesakies vizītei</h3></div></div>`;
    el.innerHTML = head + stepsBar() + '<div id="wbody"></div>';
    if ($('#abortMove')) $('#abortMove').addEventListener('click', resetWizard);
    $$('.step.done', el).forEach(s => s.addEventListener('click', () => { W.step = +s.dataset.goto; renderWizard(); }));
    if (W.step === 1) renderServices();
    if (W.step === 2) renderDateTime();
    if (W.step === 3) renderConfirm();
  }

  function renderServices() {
    const active = bookings.filter(isFuture).length;
    $('#wbody').innerHTML = (active >= S.maxActiveBookings ? `<div class="alert warn" style="margin-bottom:14px">Tev jau ir ${active} aktīvi pieraksti (maksimums ${S.maxActiveBookings}). Lai pieteiktos vēl, vispirms kādu no tiem atcel vai sagaidi vizīti.</div>` : '') + `<div class="svc-pick">${info.services.map(s => `
      <button class="svc-opt ${W.serviceId === s.id ? 'on' : ''}" data-svc="${s.id}">
        <span style="display:flex;align-items:center;gap:8px"><i class="dot" style="background:${esc(s.color)}"></i><b>${esc(s.name)}</b></span>
        <span>${fmt.dur(s.duration)}</span><span class="p">${fmt.money(s.price)}</span>
      </button>`).join('')}</div>`;
    $$('[data-svc]').forEach(b => b.addEventListener('click', () => {
      if (W.serviceId !== b.dataset.svc) { W.date = null; W.start = null; W.slots = null; }
      W.serviceId = b.dataset.svc; W.step = 2;
      W.month = W.month || todayStr().slice(0, 7);
      renderWizard();
    }));
  }

  function renderDateTime() {
    const body = $('#wbody');
    const svc = svcById(W.serviceId) || { id: W.serviceId, name: W.reschedule?.serviceName || '', duration: W.reschedule ? toMin(W.reschedule.end) - toMin(W.reschedule.start) : 60 };
    body.innerHTML = `<div id="picker"></div>
      <div class="modal-foot" style="justify-content:space-between">
        ${W.reschedule ? '<span></span>' : '<button class="btn btn-line" id="back">Atpakaļ</button>'}
        <button class="btn" id="next" ${W.start ? '' : 'disabled'}>Turpināt ${icon('arrowR')}</button></div>`;
    if ($('#back')) $('#back').addEventListener('click', () => { W.step = 1; renderWizard(); });
    $('#next').addEventListener('click', () => { W.step = 3; renderWizard(); });
    createDateTimePicker($('#picker'), {
      service: svc, daysAhead: S.bookingDaysAhead, excludeId: W.reschedule ? W.reschedule.id : null,
      month: W.month, date: W.date, start: W.start,
      onChange: v => { W.date = v.date; W.start = v.start; W.month = v.month; $('#next').disabled = !v.start; }
    });
  }

  function renderConfirm() {
    const svc = svcById(W.serviceId) || { name: W.reschedule?.serviceName, duration: 0, price: W.reschedule?.price };
    const end = fromMin(toMin(W.start) + svc.duration);
    $('#wbody').innerHTML = `<div class="summary">
        <div><span>Pakalpojums</span><b>${esc(svc.name)}</b></div>
        <div><span>Datums</span><b>${fmt.dateLong(W.date)}</b></div>
        <div><span>Laiks</span><b>${W.start} – ${end}</b></div>
        ${W.reschedule ? `<div><span>Iepriekšējais laiks</span><b style="text-decoration:line-through;opacity:.6">${fmt.dateShort(W.reschedule.date)}, ${W.reschedule.start}</b></div>` : ''}
        <div><span>Adrese</span><b>${esc(S.address || '—')}</b></div>
        <div class="total"><span>Cena</span><b>${fmt.money(W.reschedule ? W.reschedule.price : svc.price)}</b></div></div>
      ${W.reschedule ? '' : `<label class="field" style="margin-top:16px"><span>Komentārs <span class="muted">(nav obligāts)</span></span>
        <textarea class="input" id="note" maxlength="500" placeholder="Piem., vēlos apspriest jaunu krāsu…">${esc(W.note)}</textarea></label>`}
      <div class="modal-foot" style="justify-content:space-between">
        <button class="btn btn-line" id="back">Atpakaļ</button>
        <button class="btn btn-lg btn-accent" id="confirm">${W.reschedule ? 'Apstiprināt pārcelšanu' : 'Apstiprināt pierakstu'}</button></div>`;
    $('#back').addEventListener('click', () => { W.step = 2; renderWizard(); });
    if ($('#note')) $('#note').addEventListener('input', e => { W.note = e.target.value; });
    $('#confirm').addEventListener('click', e => withBusy(e.currentTarget, async () => {
      try {
        let r;
        if (W.reschedule) r = await API.put(`/api/my/bookings/${W.reschedule.id}`, { date: W.date, start: W.start });
        else r = await API.post('/api/my/bookings', { serviceId: W.serviceId, date: W.date, start: W.start, note: W.note });
        W.doneType = W.reschedule ? 'move' : 'new';
        W.done = r.booking;
        renderWizard();
        await loadBookings();
      } catch (x) {
        toast(x.message, 'error');
        if (x.status === 409 && /laiks/.test(x.message)) { W.step = 2; W.start = null; renderWizard(); }
      }
    }));
  }

  /* -------------------------------------------------- profils */
  function openProfile() {
    const { el, close } = openModal({
      title: 'Mans profils', subtitle: `Lietotājvārds: <b>${esc(me.username)}</b>`,
      body: `<form id="pf" class="form-grid">
          <label class="field full"><span>Vārds, uzvārds</span><input class="input" name="name" value="${esc(me.name)}" required></label>
          <label class="field"><span>Tālrunis</span><input class="input" name="phone" type="tel" value="${esc(me.phone || '')}" required></label>
          <label class="field"><span>E-pasts</span><input class="input" name="email" type="email" value="${esc(me.email || '')}"></label>
          <div class="full"><button class="btn" type="submit">Saglabāt</button></div>
        </form>
        <hr style="border:0;border-top:1px solid var(--line);margin:24px 0">
        <h4 style="margin-bottom:12px">Mainīt paroli</h4>
        <form id="pw" class="form-grid">
          <label class="field full"><span>Pašreizējā parole</span><input class="input" type="password" name="current" autocomplete="current-password" required></label>
          <label class="field full"><span>Jaunā parole</span><input class="input" type="password" name="next" minlength="6" autocomplete="new-password" required></label>
          <div class="full"><button class="btn btn-line" type="submit">${icon('key')} Mainīt paroli</button></div>
        </form>`
    });
    $('#pf', el).addEventListener('submit', async e => {
      e.preventDefault();
      await withBusy(e.submitter, async () => {
        try { me = (await API.put('/api/my/profile', formData(e.target))).user; renderMe(); toast('Profils saglabāts.'); close(); }
        catch (x) { toast(x.message, 'error'); }
      });
    });
    $('#pw', el).addEventListener('submit', async e => {
      e.preventDefault();
      await withBusy(e.submitter, async () => {
        try { await API.post('/api/password', formData(e.target)); toast('Parole nomainīta.'); e.target.reset(); }
        catch (x) { toast(x.message, 'error'); }
      });
    });
  }

  try { await loadBookings(); } catch (e) { toast(e.message, 'error'); }
  renderWizard();
})();
