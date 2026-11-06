'use strict';
(async () => {
  const SECTIONS = [
    ['parskats', 'Pārskats', 'grid', 'Sākums'],
    ['kalendars', 'Kalendārs', 'calendar', 'Kalend.'],
    ['pieraksti', 'Pieraksti', 'list', 'Saraksts'],
    ['klienti', 'Klienti', 'users', 'Klienti'],
    ['pakalpojumi', 'Pakalpojumi', 'tag', 'Cenas'],
    ['galerija', 'Galerija', 'image', 'Darbi'],
    ['darba-laiks', 'Darba laiks', 'clock', 'Grafiks'],
    ['iestatijumi', 'Iestatījumi', 'settings', 'Opcijas']
  ];
  const PALETTE = ['#2E3A2F', '#6B7F5B', '#C96F4F', '#B08D63', '#8FA07E', '#A35A3F', '#4F6250', '#C9A98A'];
  const view = $('#view');
  let me, settings, services = [], clients = null, schedule = null;
  let dashRange = 30, dashMetric = 'revenue';
  const cal = { view: innerWidth < 720 ? 'day' : 'week', anchor: todayStr() };
  const list = { from: addDays(todayStr(), -30), to: addDays(todayStr(), 30), status: '', q: '' };

  /* ----------------------------------------------------------- start */
  try {
    const r = await API.get('/api/me');
    if (!r.user) return location.replace('/pieslegties');
    if (r.user.role !== 'admin') return location.replace('/konts');
    me = r.user;
    const st = await API.get('/api/admin/settings');
    settings = st.settings;
    services = (await API.get('/api/admin/services')).services;
  } catch (e) { return toast(e.message, 'error'); }

  const brandHTML = () => `${BRAND_MARK}<span>${esc(settings.salonName)}</span>`;
  $('#brand').innerHTML = brandHTML();
  $('#brandMobile').innerHTML = brandHTML();
  $('#siteLink').innerHTML = `${icon('home')}Skatīt mājaslapu`;
  $('#logoutBtn').innerHTML = icon('logout');
  $('#logoutBtnM').innerHTML = icon('logout');
  $('#logoutBtn').addEventListener('click', logout);
  $('#logoutBtnM').addEventListener('click', logout);
  const renderMe = () => {
    $('#adminName').textContent = me.name || 'Administrators';
    $('#adminUser').textContent = '@' + me.username;
    $('#adminAvatar').textContent = fmt.initials(me.name || me.username);
  };
  renderMe();
  document.title = `Admin panelis — ${settings.salonName}`;

  $('#sideNav').innerHTML = SECTIONS.map(([id, label, ic]) => `<a class="side-link" href="#${id}" data-sec="${id}">${icon(ic)}<span>${label}</span></a>`).join('');
  $('#mobileNav').innerHTML = SECTIONS.map(([id, label, ic, short]) => `<a href="#${id}" data-sec="${id}" aria-label="${label}">${icon(ic)}<span>${short}</span></a>`).join('');

  const svcById = id => services.find(s => s.id === id);
  const svcColor = id => (svcById(id) || {}).color || '#6B7F5B';
  async function ensureClients(force) { if (!clients || force) clients = (await API.get('/api/admin/clients')).clients; return clients; }
  async function ensureSchedule(force) { if (!schedule || force) schedule = await API.get('/api/admin/schedule'); return schedule; }

  function route() {
    const sec = (location.hash.slice(1) || 'parskats').split('?')[0];
    const found = SECTIONS.find(s => s[0] === sec) ? sec : 'parskats';
    $$('[data-sec]').forEach(a => a.classList.toggle('on', a.dataset.sec === found));
    window.scrollTo({ top: 0 });
    ({ parskats: renderDashboard, kalendars: renderCalendar, pieraksti: renderList, klienti: renderClients, pakalpojumi: renderServices, galerija: renderGallery, 'darba-laiks': renderHours, iestatijumi: renderSettings })[found]();
  }
  addEventListener('hashchange', route);

  const pageHead = (eyebrow, title, tools = '') =>
    `<div class="page-head"><div><span class="eyebrow">${eyebrow}</span><h1 style="margin-top:6px">${title}</h1></div><div class="tools">${tools}</div></div>`;
  const loading = () => { view.innerHTML = '<div class="skeleton" style="height:60px;margin:20px 0"></div><div class="kpis">' + '<div class="skeleton" style="height:120px"></div>'.repeat(4) + '</div><div class="skeleton" style="height:320px"></div>'; };
  const deltaHTML = d => d == null ? '' : `<span class="delta ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '↑' : '↓'} ${Math.abs(d)}%</span>`;

  /* ----------------------------------------------------------- PĀRSKATS */
  async function renderDashboard() {
    loading();
    let s;
    try { s = await API.get('/api/admin/stats?range=' + dashRange); } catch (e) { return toast(e.message, 'error'); }
    const k = s.kpi;
    const h = new Date().getHours();
    const greet = h < 12 ? 'Labrīt' : h < 18 ? 'Labdien' : 'Labvakar';
    const notices = [];
    if (me.mustChangePassword) notices.push(`<div class="notice">${icon('key')}<span>Tu izmanto noklusējuma administratora paroli. Lūdzu, nomaini to drošības nolūkos.</span><a class="btn btn-sm" href="#iestatijumi">Mainīt</a></div>`);
    if (k.unmarked) notices.push(`<div class="notice">${icon('alert')}<span><b>${k.unmarked}</b> pagājušas vizītes vēl nav atzīmētas kā notikušas.</span><button class="btn btn-sm" id="markPast">Atzīmēt kā notikušas</button></div>`);
    const rangeLbl = { 7: '7 dienās', 30: '30 dienās', 90: '90 dienās' }[dashRange];
    const now = new Date().getHours() * 60 + new Date().getMinutes();

    view.innerHTML = pageHead(fmt.dateLong(todayStr()), `${greet}, <span class="serif" style="color:var(--accent)">${esc((me.name || '').split(' ')[0] || 'admin')}</span>`,
      `<div class="seg" id="rangeSeg">${[7, 30, 90].map(r => `<button data-r="${r}" class="${r === dashRange ? 'on' : ''}">${r} d.</button>`).join('')}</div>
       <button class="btn btn-accent" id="newBk">${icon('plus')}Jauns pieraksts</button>`) +
      notices.join('') +
      `<div class="kpis">
        <div class="glass kpi dark"><div class="k">${icon('euro')}Ieņēmumi ${rangeLbl}</div><div class="v">${fmt.money(k.revenue)}</div>
          <div class="d">${deltaHTML(k.revenueDelta)} pret iepriekšējo periodu</div>
          <div class="spark">${Charts.spark(s.series.map(x => x.revenue), { color: '#D9C9B2', w: 90, h: 30 })}</div></div>
        <div class="glass kpi"><div class="k">${icon('calendar')}Vizītes</div><div class="v">${fmt.num(k.bookings)}</div>
          <div class="d">${deltaHTML(k.bookingsDelta)} vid. čeks ${fmt.money(Math.round(k.avgTicket))}</div></div>
        <div class="glass kpi"><div class="k">${icon('users')}Jauni klienti</div><div class="v">${fmt.num(k.newClients)}</div>
          <div class="d">${deltaHTML(k.newClientsDelta)} kopā ${fmt.num(k.totalClients)}</div></div>
        <div class="glass kpi"><div class="k">${icon('activity')}Noslodze 7 dienām</div><div class="v">${k.occupancy}%</div>
          <div class="meter" style="background:rgba(46,58,47,.08)"><i style="width:${Math.min(100, k.occupancy)}%"></i></div>
          <div class="d">${k.upcomingCount} pieraksti · ${fmt.money(k.upcomingRevenue)} gaidāmi</div></div>
      </div>
      <div class="dash-grid">
        <section class="glass card span-8">
          <div class="card-head"><div><h3>${dashMetric === 'revenue' ? 'Ieņēmumi' : 'Vizītes'}</h3><p class="muted small">${fmt.dateShort(s.from)} – ${fmt.dateShort(s.to)}</p></div>
            <div class="seg" id="metricSeg"><button data-m="revenue" class="${dashMetric === 'revenue' ? 'on' : ''}">Ieņēmumi</button><button data-m="count" class="${dashMetric === 'count' ? 'on' : ''}">Vizītes</button></div></div>
          <div class="chart" id="areaChart"></div>
        </section>
        <section class="glass card span-4">
          <div class="card-head"><div><h3>Šodien</h3><p class="muted small">${s.today.length} ${s.today.length === 1 ? 'vizīte' : 'vizītes'} · ${fmt.money(s.today.filter(b => b.status !== 'noshow').reduce((a, b) => a + b.price, 0))}</p></div>
            <a class="btn btn-sm btn-line" href="#kalendars">Kalendārs</a></div>
          <div class="agenda">${s.today.length ? s.today.map(b => `
            <div class="agenda-item ${toMin(b.end) < now ? 'past' : ''}" data-bk="${b.id}">
              <div class="t">${b.start}<small>${b.end}</small></div><i class="bar" style="background:${esc(b.color)}"></i>
              <div style="min-width:0"><b>${esc(b.clientName)}</b><span>${esc(b.serviceName)}</span></div>
              <span class="badge ${b.status}">${LV.status[b.status]}</span></div>`).join('')
            : `<div class="empty">${icon('leaf')}<p>Šodien vizīšu nav.<br>Laiks atpūtai!</p></div>`}</div>
        </section>
        <section class="glass card span-5">
          <div class="card-head"><h3>Populārākie pakalpojumi</h3><span class="muted small">${rangeLbl}</span></div>
          <div class="donut-wrap"><div id="donut"></div><div class="legend">${s.services.slice(0, 6).map(x => `
            <div class="legend-row"><i class="dot" style="background:${esc(x.color)}"></i><span class="name">${esc(x.name)}</span><span class="muted small">${x.count}×</span><span class="val">${fmt.money(x.revenue)}</span></div>`).join('') || '<p class="muted">Nav datu.</p>'}</div></div>
        </section>
        <section class="glass card span-7">
          <div class="card-head"><h3>Noslogotākās dienas</h3><span class="muted small">vizītes pa nedēļas dienām</span></div>
          <div class="chart" id="wdChart"></div>
        </section>
        <section class="glass card span-6">
          <div class="card-head"><h3>Lojālākie klienti</h3><a class="btn btn-sm btn-line" href="#klienti">Visi klienti</a></div>
          <div class="top-list">${s.topClients.map((c, i) => `
            <div class="who"><div class="who" style="min-width:0"><span class="avatar" style="${i === 0 ? 'background:var(--accent);color:#fff' : ''}">${fmt.initials(c.name)}</span>
              <div style="min-width:0"><b>${esc(c.name)}</b><small>${c.visits} vizītes · pēdējā ${fmt.dateShort(c.last)}</small></div></div>
              <b style="font-variant-numeric:tabular-nums">${fmt.money(c.spent)}</b></div>`).join('') || '<p class="muted">Vēl nav datu.</p>'}</div>
        </section>
        <section class="glass card span-6">
          <div class="card-head"><h3>Pieprasītākie laiki</h3><span class="muted small">vizīšu sākums pa stundām</span></div>
          <div class="chart" id="hrChart"></div>
          <div style="display:flex;gap:24px;margin-top:16px;flex-wrap:wrap">
            <div><div class="muted small">Atcelšanu īpatsvars</div><b style="font-size:20px">${k.cancelRate}%</b></div>
            <div><div class="muted small">Vidējais čeks</div><b style="font-size:20px">${fmt.money(Math.round(k.avgTicket))}</b></div>
            <div><div class="muted small">Klientu kopā</div><b style="font-size:20px">${fmt.num(k.totalClients)}</b></div>
          </div>
        </section>
      </div>`;

    const labels = s.series.map(x => fmt.dateShort(x.date));
    Charts.area($('#areaChart'), {
      labels, height: 270,
      series: [dashMetric === 'revenue'
        ? { values: s.series.map(x => x.revenue), color: '#C96F4F', label: 'Ieņēmumi' }
        : { values: s.series.map(x => x.count), color: '#6B7F5B', label: 'Vizītes' }],
      format: (v, axis) => dashMetric === 'revenue' ? (axis ? `${Math.round(v)} €` : fmt.money(v)) : (axis ? Math.round(v) : `${v} viz.`),
      tipLabel: (l, i) => fmt.dateLong(s.series[i].date)
    });
    const totalSvc = s.services.reduce((a, b) => a + b.count, 0);
    Charts.donut($('#donut'), { items: s.services.map(x => ({ value: x.count, color: x.color })), center: String(totalSvc), sub: 'vizītes' });
    Charts.bars($('#wdChart'), { labels: ['P', 'O', 'T', 'C', 'Pk', 'S', 'Sv'], values: s.weekdays, height: 230 });
    const hrs = []; for (let i = 8; i <= 19; i++) hrs.push(pad(i));
    Charts.bars($('#hrChart'), { labels: hrs.map(x => String(+x)), values: hrs.map(x => s.hours[x] || 0), height: 170, color: '#2E3A2F', highlight: '#C96F4F' });

    $$('#rangeSeg button').forEach(b => b.addEventListener('click', () => { dashRange = +b.dataset.r; renderDashboard(); }));
    $$('#metricSeg button').forEach(b => b.addEventListener('click', () => { dashMetric = b.dataset.m; renderDashboard(); }));
    $('#newBk').addEventListener('click', () => bookingCreateModal({}));
    $$('[data-bk]').forEach(el => el.addEventListener('click', () => bookingEditModal(el.dataset.bk, s.today.find(b => b.id === el.dataset.bk))));
    if ($('#markPast')) $('#markPast').addEventListener('click', e => withBusy(e.currentTarget, async () => {
      const r = await API.post('/api/admin/bookings/mark-past'); toast(`Atzīmētas ${r.updated} vizītes.`); renderDashboard();
    }));
  }

  /* ----------------------------------------------------------- KALENDĀRS */
  function weekStart(d) { const w = (parseD(d).getDay() + 6) % 7; return addDays(d, -w); }

  async function renderCalendar() {
    const days = cal.view === 'week' ? [...Array(7)].map((_, i) => addDays(weekStart(cal.anchor), i)) : [cal.anchor];
    const from = days[0], to = days[days.length - 1];
    const title = cal.view === 'week'
      ? `${parseD(from).getDate()}. ${from.slice(5, 7) !== to.slice(5, 7) ? LV.monthsShort[parseD(from).getMonth()] + ' ' : ''}– ${parseD(to).getDate()}. ${LV.months[parseD(to).getMonth()]}`
      : fmt.dateLong(from);
    if (!$('#calWrap')) {
      view.innerHTML = pageHead('Kalendārs', 'Pieraksti', `<button class="btn btn-accent" id="newBk">${icon('plus')}Jauns pieraksts</button>`) +
        `<div class="week-toolbar"><button class="icon-btn" id="prev" aria-label="Iepriekš">${icon('chevL')}</button><button class="icon-btn" id="next" aria-label="Tālāk">${icon('chevR')}</button>
          <button class="btn btn-sm btn-ghost" id="todayBtn">Šodien</button><span class="title" id="calTitle"></span>
          <input type="date" class="input" id="jump" style="width:160px;height:38px;margin-left:auto" aria-label="Pāriet uz datumu">
          <div class="seg"><button data-v="day">Diena</button><button data-v="week">Nedēļa</button></div></div>
        <div class="glass week" id="calWrap"><div class="week-scroll" id="calBody"><div class="skeleton" style="height:500px;margin:20px"></div></div></div>
        <p class="muted small" style="margin-top:10px">Noklikšķini uz brīva laika, lai izveidotu pierakstu. Svītrotie laukumi — ārpus darba laika.</p>`;
      $('#prev').addEventListener('click', () => { cal.anchor = addDays(cal.anchor, cal.view === 'week' ? -7 : -1); renderCalendar(); });
      $('#next').addEventListener('click', () => { cal.anchor = addDays(cal.anchor, cal.view === 'week' ? 7 : 1); renderCalendar(); });
      $('#todayBtn').addEventListener('click', () => { cal.anchor = todayStr(); renderCalendar(); });
      $('#jump').addEventListener('change', e => { if (e.target.value) { cal.anchor = e.target.value; renderCalendar(); } });
      $$('.week-toolbar .seg button').forEach(b => b.addEventListener('click', () => { cal.view = b.dataset.v; renderCalendar(); }));
      $('#newBk').addEventListener('click', () => bookingCreateModal({ date: cal.view === 'day' ? cal.anchor : undefined }));
    }
    $('#calTitle').textContent = title;
    $('#jump').value = cal.anchor;
    $$('.week-toolbar .seg button').forEach(b => b.classList.toggle('on', b.dataset.v === cal.view));

    let bk;
    try {
      await ensureSchedule();
      bk = (await API.get(`/api/admin/bookings?from=${from}&to=${to}`)).bookings.filter(b => b.status !== 'cancelled');
    } catch (e) { return toast(e.message, 'error'); }
    const hours = schedule.hours, closures = new Map(schedule.closures.map(c => [c.date, c]));
    let minS = 24 * 60, maxE = 0;
    Object.values(hours).forEach(h => { if (h.open) { minS = Math.min(minS, toMin(h.start)); maxE = Math.max(maxE, toMin(h.end)); } });
    bk.forEach(b => { minS = Math.min(minS, toMin(b.start)); maxE = Math.max(maxE, toMin(b.end)); });
    if (minS >= maxE) { minS = 9 * 60; maxE = 18 * 60; }
    minS = Math.floor(minS / 60) * 60 - 0; maxE = Math.ceil(maxE / 60) * 60;
    const PPM = 1.25, H = (maxE - minS) * PPM;
    const t = todayStr(), nowM = new Date().getHours() * 60 + new Date().getMinutes();

    let html = `<div class="week-grid" style="--cols:${days.length}"><div class="corner"></div>`;
    days.forEach(d => {
      const dayBk = bk.filter(b => b.date === d && b.status !== 'noshow');
      html += `<div class="head ${d === t ? 'today' : ''}"><small>${LV.daysShort[parseD(d).getDay()]}</small><b>${parseD(d).getDate()}</b>
        <div class="sum">${closures.has(d) ? esc(closures.get(d).reason || 'Slēgts') : dayBk.length ? `${dayBk.length} · ${fmt.money(dayBk.reduce((a, b) => a + b.price, 0))}` : '&nbsp;'}</div></div>`;
    });
    html += `<div class="times" style="height:${H}px">`;
    for (let m = minS; m <= maxE; m += 60) html += `<span style="top:${(m - minS) * PPM}px">${fromMin(m)}</span>`;
    html += '</div>';
    days.forEach(d => {
      const h = hours[parseD(d).getDay()];
      const closed = closures.has(d) || !h || !h.open;
      html += `<div class="day-col" data-date="${d}" style="height:${H}px">`;
      for (let m = minS; m < maxE; m += 30) html += `<div class="hl ${m % 60 ? 'half' : ''}" style="top:${(m - minS) * PPM}px"></div>`;
      const shade = (a, b) => b > a ? `<div class="closed" style="top:${(a - minS) * PPM}px;height:${(b - a) * PPM}px"></div>` : '';
      if (closed) html += shade(minS, maxE);
      else {
        html += shade(minS, toMin(h.start)) + shade(toMin(h.end), maxE);
        if (h.breakStart && h.breakEnd) html += shade(toMin(h.breakStart), toMin(h.breakEnd));
      }
      // pārklājošos pierakstu izkārtojums joslās
      const evs = bk.filter(b => b.date === d).map(b => ({ b, s: toMin(b.start), e: toMin(b.end) })).sort((a, c) => a.s - c.s);
      let cluster = [], cEnd = -1;
      const flush = () => { const n = Math.max(...cluster.map(x => x.lane)) + 1; cluster.forEach(x => { x.n = n; }); cluster = []; };
      evs.forEach(ev => {
        if (ev.s >= cEnd && cluster.length) flush();
        const used = new Set(cluster.filter(x => x.e > ev.s).map(x => x.lane));
        let lane = 0; while (used.has(lane)) lane++;
        ev.lane = lane; cluster.push(ev); cEnd = Math.max(cEnd, ev.e);
      });
      if (cluster.length) flush();
      evs.forEach(({ b, s, e, lane, n }) => {
        const short = (e - s) < 40;
        html += `<div class="ev ${b.status}" data-bk="${b.id}" style="--c:${esc(b.color)};top:${(s - minS) * PPM + 1}px;height:${(e - s) * PPM - 2}px;left:calc(${(lane / n) * 100}% + 4px);right:auto;width:calc(${100 / n}% - 8px)" title="${esc(b.clientName)} — ${esc(b.serviceName)}">
          ${short ? `<b><span class="tm">${b.start}</span> ${esc(b.clientName)}</b>` : `<span class="tm">${b.start}–${b.end}</span><b>${esc(b.clientName)}</b><span>${esc(b.serviceName)}</span>`}</div>`;
      });
      if (d === t && nowM >= minS && nowM <= maxE) html += `<div class="now" style="top:${(nowM - minS) * PPM}px"></div>`;
      html += '</div>';
    });
    html += '</div>';
    $('#calBody').innerHTML = html;

    $$('#calBody .ev').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); bookingEditModal(el.dataset.bk, bk.find(b => b.id === el.dataset.bk)); }));
    $$('#calBody .day-col').forEach(col => col.addEventListener('click', e => {
      const y = e.clientY - col.getBoundingClientRect().top;
      const step = settings.slotStep || 15;
      const m = minS + Math.floor(y / PPM / step) * step;
      bookingCreateModal({ date: col.dataset.date, start: fromMin(m) });
    }));
    // ritināt uz darba sākumu / tagadni
    if (cal.view === 'day' || innerWidth < 720) $('#calBody').scrollLeft = 0;
  }

  /* ----------------------------------------------------------- PIERAKSTU SARAKSTS */
  async function renderList() {
    view.innerHTML = pageHead('Pārvaldība', 'Visi pieraksti', `<a class="btn btn-line" href="/api/admin/export/bookings.csv">${icon('download')}Eksportēt CSV</a>
      <button class="btn btn-accent" id="newBk">${icon('plus')}Jauns pieraksts</button>`) +
      `<div class="glass card">
        <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:18px" id="filters">
          <label class="field"><span>No</span><input type="date" class="input" name="from" value="${list.from}"></label>
          <label class="field"><span>Līdz</span><input type="date" class="input" name="to" value="${list.to}"></label>
          <label class="field"><span>Statuss</span><select class="input" name="status"><option value="">Visi</option>${Object.entries(LV.status).map(([k, v]) => `<option value="${k}" ${list.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="field"><span>Meklēt</span><input class="input" name="q" placeholder="Vārds, tālrunis, pakalpojums" value="${esc(list.q)}"></label>
        </div>
        <div id="listSummary" class="muted small" style="margin-bottom:8px"></div>
        <div class="table-wrap" id="listTable"><div class="skeleton" style="height:300px"></div></div>
      </div>`;
    $('#newBk').addEventListener('click', () => bookingCreateModal({}));
    let timer;
    $('#filters').addEventListener('input', e => {
      list[e.target.name] = e.target.value;
      clearTimeout(timer); timer = setTimeout(loadList, e.target.name === 'q' ? 250 : 0);
    });
    loadList();
  }
  async function loadList() {
    const q = new URLSearchParams({ from: list.from, to: list.to, status: list.status, q: list.q });
    let rows;
    try { rows = (await API.get('/api/admin/bookings?' + q)).bookings; } catch (e) { return toast(e.message, 'error'); }
    const valid = rows.filter(b => b.status === 'booked' || b.status === 'completed');
    $('#listSummary').textContent = `${rows.length} ieraksti · ${fmt.money(valid.reduce((a, b) => a + b.price, 0))}`;
    $('#listTable').innerHTML = rows.length ? `<table class="table"><thead><tr><th>Datums</th><th>Laiks</th><th>Klients</th><th class="hide-sm">Pakalpojums</th><th class="num">Cena</th><th>Statuss</th></tr></thead><tbody>
      ${rows.map(b => `<tr class="clickable" data-bk="${b.id}">
        <td style="white-space:nowrap"><b>${fmt.dateShort(b.date)}</b> <span class="muted small">${LV.daysShort[parseD(b.date).getDay()]}</span></td>
        <td style="font-variant-numeric:tabular-nums;white-space:nowrap">${b.start}–${b.end}</td>
        <td><div class="who"><span class="avatar hide-sm">${fmt.initials(b.clientName)}</span><div><b>${esc(b.clientName)}</b><small>${esc(b.clientPhone || (b.guest ? 'bez konta' : ''))}</small></div></div></td>
        <td class="hide-sm"><span style="display:inline-flex;align-items:center;gap:8px"><i class="dot" style="background:${esc(b.color)}"></i>${esc(b.serviceName)}</span></td>
        <td class="num">${fmt.money(b.price)}</td><td><span class="badge ${b.status}">${LV.status[b.status]}</span></td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">${icon('search')}<p>Nekas netika atrasts.</p></div>`;
    $$('#listTable [data-bk]').forEach(tr => tr.addEventListener('click', () => bookingEditModal(tr.dataset.bk, rows.find(b => b.id === tr.dataset.bk))));
  }

  /* ----------------------------------------------------------- PIERAKSTA MODĀĻI */
  const refreshCurrent = () => {
    if (location.hash === '#kalendars') { renderCalendar(); }
    else if (location.hash === '#pieraksti') loadList();
    else if (location.hash === '#klienti') { clients = null; renderClients(); }
    else if (location.hash === '' || location.hash === '#parskats') renderDashboard();
  };

  function serviceOptions(sel) {
    return services.map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)} — ${fmt.dur(s.duration)}, ${fmt.money(s.price)}${s.active ? '' : ' (neaktīvs)'}</option>`).join('');
  }

  async function slotChips(m, excludeId) {
    const box = $('#slotChips', m);
    const f = $('form', m);
    const date = f.date.value, serviceId = f.serviceId.value;
    if (!date || !serviceId) { box.innerHTML = ''; return; }
    box.innerHTML = '<span class="muted small">Ielādē brīvos laikus…</span>';
    try {
      const q = new URLSearchParams({ serviceId, date }); if (excludeId) q.set('exclude', excludeId);
      const { slots } = await API.get('/api/slots?' + q);
      box.innerHTML = slots.length ? `<span class="label" style="display:block;margin-bottom:8px">Brīvie laiki</span><div class="slots">${slots.map(s => `<button type="button" class="slot ${s === f.start.value ? 'on' : ''}" data-s="${s}" style="height:34px;min-width:64px">${s}</button>`).join('')}</div>`
        : '<span class="muted small">Šajā dienā brīvu laiku nav (vari ievadīt laiku manuāli).</span>';
      $$('[data-s]', box).forEach(b => b.addEventListener('click', () => { f.start.value = b.dataset.s; $$('.slot', box).forEach(x => x.classList.toggle('on', x === b)); }));
    } catch { box.innerHTML = ''; }
  }

  async function saveWithConflict(fn) {
    try { return await fn(false); } catch (e) {
      if (e.status === 409 && /pārklājas/.test(e.message)) {
        const ok = await confirmDialog('Šis laiks pārklājas ar citu pierakstu. Vai saglabāt tik un tā?', { title: 'Laiks aizņemts', ok: 'Saglabāt' });
        if (ok) return fn(true);
        return null;
      }
      throw e;
    }
  }

  async function bookingCreateModal({ date, start, userId }) {
    await ensureClients();
    const active = services.filter(s => s.active);
    const { el, close } = openModal({
      title: 'Jauns pieraksts', wide: true,
      body: `<form class="form-grid">
        <label class="field full"><span>Klients</span><select class="input" name="userId">
          <option value="">— Klients bez konta —</option>
          ${clients.filter(c => c.active).map(c => `<option value="${c.id}" ${c.id === userId ? 'selected' : ''}>${esc(c.name)}${c.phone ? ' · ' + esc(c.phone) : ''}</option>`).join('')}</select></label>
        <label class="field guest"><span>Vārds</span><input class="input" name="guestName" placeholder="Klienta vārds"></label>
        <label class="field guest"><span>Tālrunis</span><input class="input" name="guestPhone" type="tel" placeholder="+371 …"></label>
        <label class="field full"><span>Pakalpojums</span><select class="input" name="serviceId">${active.map(s => `<option value="${s.id}">${esc(s.name)} — ${fmt.dur(s.duration)}, ${fmt.money(s.price)}</option>`).join('')}</select></label>
        <label class="field"><span>Datums</span><input class="input" type="date" name="date" value="${date || todayStr()}" required></label>
        <label class="field"><span>Sākums</span><input class="input" type="time" name="start" step="300" value="${start || ''}" required></label>
        <div class="full" id="slotChips"></div>
        <label class="field"><span>Ilgums (min)</span><input class="input" type="number" name="duration" min="5" step="5" value="${active[0] ? active[0].duration : 60}"></label>
        <label class="field"><span>Cena (€)</span><input class="input" type="number" name="price" min="0" step="0.5" value="${active[0] ? active[0].price : ''}"></label>
        <label class="field full"><span>Piezīme</span><input class="input" name="adminNote" placeholder="Iekšēja piezīme (klients to neredz)"></label>
      </form>`,
      foot: `<button class="btn btn-line" data-close>Atcelt</button><button class="btn btn-accent" id="saveBk">Izveidot pierakstu</button>`
    });
    const f = $('form', el);
    const syncGuest = () => $$('.guest', el).forEach(x => x.classList.toggle('hidden', !!f.userId.value));
    syncGuest();
    f.userId.addEventListener('change', syncGuest);
    f.serviceId.addEventListener('change', () => { const s = svcById(f.serviceId.value); f.duration.value = s.duration; f.price.value = s.price; slotChips(el); });
    f.date.addEventListener('change', () => slotChips(el));
    slotChips(el);
    $('#saveBk', el).addEventListener('click', e => withBusy(e.currentTarget, async () => {
      if (!f.reportValidity()) return;
      const data = formData(f);
      try {
        const r = await saveWithConflict(force => API.post('/api/admin/bookings', { ...data, force }));
        if (!r) return;
        toast('Pieraksts izveidots.'); close(); refreshCurrent();
      } catch (x) { toast(x.message, 'error'); }
    }));
  }

  async function bookingEditModal(id, b) {
    if (!b) return;
    await ensureClients();
    const dur = toMin(b.end) - toMin(b.start);
    const client = b.userId ? clients.find(c => c.id === b.userId) : null;
    const { el, close } = openModal({
      title: b.clientName, wide: true,
      subtitle: `${fmt.dateLong(b.date)} · ${b.start}–${b.end} · <span class="badge ${b.status}" style="vertical-align:middle">${LV.status[b.status]}</span>`,
      body: `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px">
          ${b.clientPhone ? `<a class="btn btn-sm btn-ghost" href="tel:${esc(b.clientPhone.replace(/\s/g, ''))}">${icon('phone')}${esc(b.clientPhone)}</a>` : ''}
          ${client ? `<button type="button" class="btn btn-sm btn-ghost" id="openClient">${icon('user')}Klienta kartiņa</button>` : '<span class="chip">Klients bez konta</span>'}
          ${b.createdBy === 'guest' ? '<span class="chip">Pieteikts tiešsaistē</span>' : b.createdBy === 'client' ? '<span class="chip">Pieteikts kontā</span>' : ''}
        </div>
        ${b.note ? `<div class="alert info" style="margin-bottom:16px"><b>Klienta komentārs:</b> ${esc(b.note)}</div>` : ''}
        <form class="form-grid">
          <div class="field full"><span>Statuss</span><div class="seg" id="stSeg" style="flex-wrap:wrap">${Object.entries(LV.status).map(([k, v]) => `<button type="button" data-st="${k}" class="${k === b.status ? 'on' : ''}">${v}</button>`).join('')}</div></div>
          <label class="field full"><span>Pakalpojums</span><select class="input" name="serviceId">${serviceOptions(b.serviceId)}</select></label>
          <label class="field"><span>Datums</span><input class="input" type="date" name="date" value="${b.date}"></label>
          <label class="field"><span>Sākums</span><input class="input" type="time" name="start" step="300" value="${b.start}"></label>
          <div class="full" id="slotChips"></div>
          <label class="field"><span>Ilgums (min)</span><input class="input" type="number" name="duration" min="5" step="5" value="${dur}"></label>
          <label class="field"><span>Cena (€)</span><input class="input" type="number" name="price" min="0" step="0.5" value="${b.price}"></label>
          <label class="field full"><span>Iekšēja piezīme</span><textarea class="input" name="adminNote" rows="2" style="min-height:64px">${esc(b.adminNote || '')}</textarea></label>
        </form>`,
      foot: `<button class="btn btn-danger spacer" id="delBk">${icon('trash')}Dzēst</button><button class="btn btn-line" data-close>Aizvērt</button><button class="btn" id="saveBk">Saglabāt</button>`
    });
    const f = $('form', el);
    let status = b.status;
    $$('#stSeg button', el).forEach(x => x.addEventListener('click', () => { status = x.dataset.st; $$('#stSeg button', el).forEach(y => y.classList.toggle('on', y === x)); }));
    f.serviceId.addEventListener('change', () => { const s = svcById(f.serviceId.value); if (s) { f.duration.value = s.duration; f.price.value = s.price; } slotChips(el, b.id); });
    f.date.addEventListener('change', () => slotChips(el, b.id));
    if (b.status === 'booked') slotChips(el, b.id);
    if ($('#openClient', el)) $('#openClient', el).addEventListener('click', () => { close(); clientModal(client); });
    $('#saveBk', el).addEventListener('click', e => withBusy(e.currentTarget, async () => {
      const data = { ...formData(f), status };
      try {
        const r = await saveWithConflict(force => API.put(`/api/admin/bookings/${b.id}`, { ...data, force }));
        if (!r) return;
        toast('Izmaiņas saglabātas.'); close(); refreshCurrent();
      } catch (x) { toast(x.message, 'error'); }
    }));
    $('#delBk', el).addEventListener('click', async () => {
      if (!await confirmDialog('Pieraksts tiks neatgriezeniski dzēsts. Ja vizīte vienkārši nenotiks, labāk izvēlies statusu “Atcelts” — tā saglabāsies statistikā.', { title: 'Dzēst pierakstu?', ok: 'Dzēst', danger: true })) return;
      try { await API.del(`/api/admin/bookings/${b.id}`); toast('Pieraksts dzēsts.'); close(); refreshCurrent(); } catch (x) { toast(x.message, 'error'); }
    });
  }

  /* ----------------------------------------------------------- KLIENTI */
  let clientQ = '';
  async function renderClients() {
    view.innerHTML = pageHead('Klientu bāze', 'Klienti', `<button class="btn btn-accent" id="newCl">${icon('plus')}Jauns klients</button>`) +
      `<div class="glass card"><div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
        <div class="input-group" style="flex:1;min-width:220px"><input class="input" id="clQ" placeholder="Meklēt pēc vārda, tālruņa vai lietotājvārda" value="${esc(clientQ)}"><span class="icon-btn" style="pointer-events:none">${icon('search')}</span></div>
        <span class="muted small" id="clCount"></span></div>
        <div class="table-wrap" id="clTable"><div class="skeleton" style="height:300px"></div></div></div>`;
    $('#newCl').addEventListener('click', () => clientModal(null));
    $('#clQ').addEventListener('input', e => { clientQ = e.target.value; drawClients(); });
    try { await ensureClients(true); } catch (e) { return toast(e.message, 'error'); }
    drawClients();
  }
  function drawClients() {
    const q = clientQ.toLowerCase().trim();
    const rows = clients.filter(c => !q || `${c.name} ${c.phone} ${c.username} ${c.email}`.toLowerCase().includes(q));
    $('#clCount').textContent = `${rows.length} no ${clients.length}`;
    $('#clTable').innerHTML = rows.length ? `<table class="table"><thead><tr><th>Klients</th><th class="hide-sm">Tālrunis</th><th class="num">Vizītes</th><th class="num">Iztērēts</th><th class="hide-sm">Pēdējā vizīte</th><th class="hide-sm">Nākamā</th><th></th></tr></thead><tbody>
      ${rows.map(c => `<tr class="clickable" data-cl="${c.id}">
        <td><div class="who"><span class="avatar">${fmt.initials(c.name)}</span><div><b>${esc(c.name)}</b><small>@${esc(c.username)}</small></div></div></td>
        <td class="hide-sm">${esc(c.phone || '—')}</td><td class="num">${c.visits}</td><td class="num">${fmt.money(c.spent)}</td>
        <td class="hide-sm">${c.lastVisit ? fmt.dateShort(c.lastVisit) : '—'}</td>
        <td class="hide-sm">${c.nextVisit ? `${fmt.dateShort(c.nextVisit.slice(0, 10))}, ${c.nextVisit.slice(11)}` : '—'}</td>
        <td>${c.active ? '' : '<span class="badge noshow">Bloķēts</span>'}${c.noShows ? ` <span class="badge cancelled" title="Neieradās">${c.noShows}× neieradās</span>` : ''}</td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">${icon('users')}<p>${clients.length ? 'Nekas netika atrasts.' : 'Vēl nav neviena klienta.'}</p></div>`;
    $$('#clTable [data-cl]').forEach(tr => tr.addEventListener('click', () => clientModal(clients.find(c => c.id === tr.dataset.cl))));
  }

  function showCreds(username, password) {
    const text = `Lietotājvārds: ${username}\nParole: ${password}\nPieslēgties: ${location.origin}/pieslegties`;
    const { el } = openModal({
      title: 'Pieejas dati', subtitle: 'Nodod šos datus klientam. Parole vēlāk vairs nebūs redzama.',
      body: `<div class="creds"><span>Lietotājvārds</span>${esc(username)}<span>Parole</span>${esc(password)}<span>Adrese</span>${esc(location.origin)}/pieslegties</div>`,
      foot: `<button class="btn btn-line" id="cp">${icon('copy')}Kopēt</button><button class="btn" data-close>Gatavs</button>`
    });
    $('#cp', el).addEventListener('click', async () => { try { await navigator.clipboard.writeText(text); toast('Nokopēts.'); } catch { toast('Neizdevās nokopēt.', 'error'); } });
  }

  async function clientModal(c) {
    const isNew = !c;
    let history = [];
    if (!isNew) { try { history = (await API.get(`/api/admin/bookings?userId=${c.id}&order=desc`)).bookings; } catch { /* */ } }
    const { el, close } = openModal({
      title: isNew ? 'Jauns klients' : c.name, wide: true,
      subtitle: isNew ? 'Izveido kontu un nodod klientam lietotājvārdu un paroli.' : `Klients kopš ${fmt.dateFull(c.createdAt.slice(0, 10))} · ${c.visits} vizītes · ${fmt.money(c.spent)}`,
      body: `<form class="form-grid">
          <label class="field"><span>Vārds, uzvārds</span><input class="input" name="name" value="${esc(c?.name || '')}" required></label>
          <label class="field"><span>Lietotājvārds</span><input class="input" name="username" value="${esc(c?.username || '')}" required autocapitalize="none" spellcheck="false"></label>
          <label class="field"><span>Tālrunis</span><input class="input" name="phone" type="tel" value="${esc(c?.phone || '')}"></label>
          <label class="field"><span>E-pasts</span><input class="input" name="email" type="email" value="${esc(c?.email || '')}"></label>
          ${isNew ? `<label class="field full"><span>Parole</span><div class="input-group"><input class="input" name="password" value="${genPassword()}" required minlength="6">
            <button type="button" class="icon-btn" id="regen" title="Ģenerēt jaunu">${icon('refresh')}</button></div></label>` : ''}
          <label class="field full"><span>Piezīmes <span class="muted">(redz tikai administrators)</span></span><textarea class="input" name="notes" placeholder="Piem., matu tips, iecienītā krāsa, alerģijas…">${esc(c?.notes || '')}</textarea></label>
          ${isNew ? '' : `<label class="switch full"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}><span class="track"></span>Konts aktīvs (var pieslēgties un pierakstīties)</label>`}
        </form>
        ${isNew ? '' : `<hr style="border:0;border-top:1px solid var(--line);margin:22px 0">
          <div class="card-head" style="margin-bottom:10px"><h3>Vizīšu vēsture</h3><button class="btn btn-sm btn-sage" id="bookFor">${icon('plus')}Pierakstīt</button></div>
          <div style="max-height:260px;overflow:auto">${history.length ? `<table class="table"><tbody>${history.map(b => `<tr><td style="white-space:nowrap">${fmt.dateShort(b.date)} ${b.date.slice(0, 4)}</td><td>${b.start}</td><td>${esc(b.serviceName)}</td><td class="num">${fmt.money(b.price)}</td><td><span class="badge ${b.status}">${LV.status[b.status]}</span></td></tr>`).join('')}</tbody></table>` : '<p class="muted small">Vēl nav vizīšu.</p>'}</div>`}`,
      foot: isNew ? `<button class="btn btn-line" data-close>Atcelt</button><button class="btn btn-accent" id="saveCl">Izveidot klientu</button>`
        : `<button class="btn btn-danger spacer" id="delCl">${icon('trash')}Dzēst</button><button class="btn btn-line" id="resetPw">${icon('key')}Jauna parole</button><button class="btn" id="saveCl">Saglabāt</button>`
    });
    const f = $('form', el);
    if (isNew) {
      f.name.addEventListener('input', () => { if (!f.username.dataset.touched) f.username.value = slugUsername(f.name.value); });
      f.username.addEventListener('input', () => { f.username.dataset.touched = 1; });
      $('#regen', el).addEventListener('click', () => { f.password.value = genPassword(); });
    }
    $('#saveCl', el).addEventListener('click', e => withBusy(e.currentTarget, async () => {
      if (!f.reportValidity()) return;
      const data = formData(f);
      try {
        if (isNew) {
          await API.post('/api/admin/clients', data);
          close(); showCreds(data.username.toLowerCase(), data.password);
        } else { await API.put(`/api/admin/clients/${c.id}`, data); toast('Klienta dati saglabāti.'); close(); }
        clients = null; if (location.hash === '#klienti') renderClients();
      } catch (x) { toast(x.message, 'error'); }
    }));
    if (!isNew) {
      $('#bookFor', el).addEventListener('click', () => { close(); bookingCreateModal({ userId: c.id }); });
      $('#resetPw', el).addEventListener('click', async () => {
        if (!await confirmDialog(`Ģenerēt jaunu paroli klientam <b>${esc(c.name)}</b>? Vecā parole vairs nedarbosies.`, { title: 'Jauna parole', ok: 'Ģenerēt' })) return;
        const pw = genPassword();
        try { await API.put(`/api/admin/clients/${c.id}`, { password: pw }); close(); showCreds(c.username, pw); } catch (x) { toast(x.message, 'error'); }
      });
      $('#delCl', el).addEventListener('click', async () => {
        if (!await confirmDialog(`Dzēst klientu <b>${esc(c.name)}</b>? Nākotnes pieraksti tiks atcelti, vizīšu vēsture saglabāsies statistikā.`, { title: 'Dzēst klientu?', ok: 'Dzēst', danger: true })) return;
        try { await API.del(`/api/admin/clients/${c.id}`); toast('Klients dzēsts.'); close(); clients = null; if (location.hash === '#klienti') renderClients(); } catch (x) { toast(x.message, 'error'); }
      });
    }
  }

  /* ----------------------------------------------------------- PAKALPOJUMI */
  async function renderServices() {
    try { services = (await API.get('/api/admin/services')).services; } catch (e) { return toast(e.message, 'error'); }
    view.innerHTML = pageHead('Cenrādis', 'Pakalpojumi', `<button class="btn btn-accent" id="newSvc">${icon('plus')}Jauns pakalpojums</button>`) +
      `<div class="svc-admin">${services.map(s => `
        <article class="glass service ${s.active ? '' : 'inactive'}" data-svc="${s.id}" tabindex="0">
          <div style="display:flex;justify-content:space-between;align-items:center"><div class="swatch" style="background:${esc(s.color)}">${icon('scissors')}</div>
            ${s.active ? '<span class="badge completed">Aktīvs</span>' : '<span class="badge cancelled">Paslēpts</span>'}</div>
          <h3>${esc(s.name)}</h3><p>${esc(s.description || '')}</p>
          <div class="meta"><span class="price">${fmt.money(s.price)}</span><span class="dur">${icon('clock')}${fmt.dur(s.duration)}</span></div>
        </article>`).join('')}</div>`;
    $('#newSvc').addEventListener('click', () => serviceModal(null));
    $$('[data-svc]').forEach(c => {
      const open = () => serviceModal(services.find(s => s.id === c.dataset.svc));
      c.addEventListener('click', open);
      c.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
    });
  }
  function serviceModal(s) {
    const isNew = !s;
    const color = s?.color || PALETTE[services.length % PALETTE.length];
    const { el, close } = openModal({
      title: isNew ? 'Jauns pakalpojums' : 'Rediģēt pakalpojumu',
      body: `<form class="form-grid">
        <label class="field full"><span>Nosaukums</span><input class="input" name="name" value="${esc(s?.name || '')}" required></label>
        <label class="field full"><span>Apraksts</span><textarea class="input" name="description" maxlength="300">${esc(s?.description || '')}</textarea></label>
        <label class="field"><span>Ilgums (min)</span><input class="input" type="number" name="duration" min="5" step="5" value="${s?.duration || 60}" required></label>
        <label class="field"><span>Cena (€)</span><input class="input" type="number" name="price" min="0" step="0.5" value="${s?.price ?? ''}" required></label>
        <div class="field full"><span>Krāsa kalendārā</span><div class="color-pick">${PALETTE.map(c => `<label><input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div></div>
        <label class="field"><span>Secība sarakstā</span><input class="input" type="number" name="order" min="0" value="${s?.order ?? services.length}"></label>
        <label class="switch" style="align-self:end;padding-bottom:10px"><input type="checkbox" name="active" ${s?.active === false ? '' : 'checked'}><span class="track"></span>Redzams klientiem</label>
      </form>`,
      foot: `${isNew ? '' : `<button class="btn btn-danger spacer" id="delSvc">${icon('trash')}Dzēst</button>`}<button class="btn btn-line" data-close>Atcelt</button><button class="btn" id="saveSvc">Saglabāt</button>`
    });
    const f = $('form', el);
    $('#saveSvc', el).addEventListener('click', e => withBusy(e.currentTarget, async () => {
      if (!f.reportValidity()) return;
      try {
        if (isNew) await API.post('/api/admin/services', formData(f)); else await API.put(`/api/admin/services/${s.id}`, formData(f));
        toast('Pakalpojums saglabāts.'); close(); renderServices();
      } catch (x) { toast(x.message, 'error'); }
    }));
    if (!isNew) $('#delSvc', el).addEventListener('click', async () => {
      if (!await confirmDialog('Pakalpojums tiks dzēsts. Esošie pieraksti saglabāsies. Ja vēlies to tikai paslēpt, izslēdz “Redzams klientiem”.', { title: 'Dzēst pakalpojumu?', ok: 'Dzēst', danger: true })) return;
      try { await API.del(`/api/admin/services/${s.id}`); toast('Pakalpojums dzēsts.'); close(); renderServices(); } catch (x) { toast(x.message, 'error'); }
    });
  }

  /* ----------------------------------------------------------- DARBA LAIKS */
  async function renderHours() {
    try { await ensureSchedule(true); } catch (e) { return toast(e.message, 'error'); }
    const order = [1, 2, 3, 4, 5, 6, 0];
    const h = schedule.hours;
    view.innerHTML = pageHead('Grafiks', 'Darba laiks', '') + `<div class="dash-grid">
      <section class="glass card span-7"><div class="card-head"><div><h3>Nedēļas grafiks</h3><p class="muted small">Klienti var pierakstīties tikai darba laikā, ārpus pārtraukumiem.</p></div></div>
        <form id="hoursForm">${order.map(d => `
          <div class="hours-row ${h[d].open ? '' : 'closed'}" data-d="${d}">
            <label class="switch"><input type="checkbox" name="open" ${h[d].open ? 'checked' : ''}><span class="track"></span><b>${cap(LV.days[d])}</b></label>
            <div class="times-in">
              <input class="input" type="time" name="start" value="${h[d].start}" aria-label="Sākums"><span class="sep">–</span><input class="input" type="time" name="end" value="${h[d].end}" aria-label="Beigas">
              <span class="lbl">Pārtraukums</span><input class="input" type="time" name="breakStart" value="${h[d].breakStart}" aria-label="Pārtraukuma sākums"><span class="sep">–</span><input class="input" type="time" name="breakEnd" value="${h[d].breakEnd}" aria-label="Pārtraukuma beigas">
            </div></div>`).join('')}
          <div style="margin-top:18px"><button class="btn" type="submit">Saglabāt grafiku</button></div></form></section>
      <section class="glass card span-5"><div class="card-head"><div><h3>Brīvdienas un atvaļinājumi</h3><p class="muted small">Šajās dienās pierakstīties nevarēs.</p></div></div>
        <form id="clForm" class="form-grid">
          <label class="field"><span>No</span><input class="input" type="date" name="from" required min="${todayStr()}"></label>
          <label class="field"><span>Līdz</span><input class="input" type="date" name="to" min="${todayStr()}"></label>
          <label class="field full"><span>Iemesls</span><input class="input" name="reason" placeholder="Atvaļinājums, svētki…"></label>
          <div class="full"><button class="btn btn-sage" type="submit">${icon('plus')}Pievienot</button></div></form>
        <div style="margin-top:20px;display:grid;gap:8px" id="clList"></div></section></div>`;
    const drawClosures = () => {
      const up = schedule.closures.filter(c => c.date >= todayStr());
      $('#clList').innerHTML = up.length ? up.map(c => `<div class="booking-item" style="padding:10px 12px"><div class="date-tile" style="width:48px;height:50px"><small>${LV.monthsShort[parseD(c.date).getMonth()]}</small><b style="font-size:18px">${parseD(c.date).getDate()}</b></div>
        <div class="info"><b>${cap(LV.days[parseD(c.date).getDay()])}</b><span>${esc(c.reason || 'Slēgts')}</span></div><button class="icon-btn" data-del="${c.id}" aria-label="Noņemt">${icon('x')}</button></div>`).join('')
        : '<p class="muted small">Nav ieplānotu brīvdienu.</p>';
      $$('#clList [data-del]').forEach(b => b.addEventListener('click', async () => {
        try { await API.del(`/api/admin/closures/${b.dataset.del}`); await ensureSchedule(true); drawClosures(); toast('Noņemts.'); } catch (x) { toast(x.message, 'error'); }
      }));
    };
    drawClosures();
    $$('#hoursForm [name=open]').forEach(cb => cb.addEventListener('change', () => cb.closest('.hours-row').classList.toggle('closed', !cb.checked)));
    $('#hoursForm').addEventListener('submit', async e => {
      e.preventDefault();
      const hours = {};
      $$('.hours-row', e.target).forEach(r => {
        hours[r.dataset.d] = { open: $('[name=open]', r).checked, start: $('[name=start]', r).value, end: $('[name=end]', r).value, breakStart: $('[name=breakStart]', r).value, breakEnd: $('[name=breakEnd]', r).value };
      });
      await withBusy(e.submitter, async () => {
        try { await API.put('/api/admin/hours', { hours }); await ensureSchedule(true); toast('Darba laiks saglabāts.'); } catch (x) { toast(x.message, 'error'); }
      });
    });
    $('#clForm').addEventListener('submit', async e => {
      e.preventDefault();
      await withBusy(e.submitter, async () => {
        try {
          const r = await API.post('/api/admin/closures', formData(e.target));
          await ensureSchedule(true); drawClosures(); e.target.reset();
          toast(`Pievienotas ${r.added.length} dienas.`);
          if (r.affected) toast(`Uzmanību: šajās dienās ir ${r.affected} pieraksti — sazinies ar klientiem.`, 'error');
        } catch (x) { toast(x.message, 'error'); }
      });
    });
  }

  /* ----------------------------------------------------------- IESTATĪJUMI */
  async function renderSettings() {
    try { settings = (await API.get('/api/admin/settings')).settings; } catch (e) { return toast(e.message, 'error'); }
    const s = settings;
    view.innerHTML = pageHead('Konfigurācija', 'Iestatījumi', '') + `<div class="dash-grid">
      <section class="glass card span-7"><div class="card-head"><h3>Salona informācija</h3></div>
        <form id="infoForm" class="form-grid">
          <label class="field"><span>Nosaukums</span><input class="input" name="salonName" value="${esc(s.salonName)}" required></label>
          <label class="field"><span>Tālrunis</span><input class="input" name="phone" value="${esc(s.phone)}"></label>
          <label class="field full"><span>Sauklis (rādās sadaļā „Par mani”)</span><input class="input" name="tagline" value="${esc(s.tagline)}"></label>
          <div class="field full"><span>„Par mani” foto</span>
            <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
              ${s.aboutPhoto ? `<img class="about-admin-photo" src="${esc(s.aboutPhoto)}" alt="Pašreizējais foto">` : '<span class="muted small">Foto netiek rādīts.</span>'}
              <div style="display:grid;gap:8px">
                <label class="btn btn-sm btn-line" style="position:relative;overflow:hidden">${icon('upload')}Mainīt foto<input type="file" accept="image/*" id="aboutPhotoIn" style="position:absolute;inset:0;opacity:0;cursor:pointer"></label>
                ${s.aboutPhoto !== '/img/lasma.jpg' ? '<button type="button" class="btn btn-sm btn-ghost" id="aboutPhotoReset">Atjaunot sākotnējo</button>' : ''}
                ${s.aboutPhoto ? '<button type="button" class="btn btn-sm btn-ghost" id="aboutPhotoHide">Noņemt foto</button>' : ''}
              </div></div></div>
          <label class="field"><span>Vārds („Es esmu …”)</span><input class="input" name="ownerName" maxlength="60" value="${esc(s.ownerName || '')}"></label>
          <label class="field"><span>Apakšvirsraksts</span><input class="input" name="ownerTitle" maxlength="60" value="${esc(s.ownerTitle || '')}" placeholder="Tava friziere"></label>
          <label class="field full"><span>Par mani</span><textarea class="input" name="about" rows="4">${esc(s.about)}</textarea></label>
          <label class="field full"><span>Citāts</span><input class="input" name="aboutQuote" maxlength="120" value="${esc(s.aboutQuote || '')}" placeholder="Tavi mati — mana aizraušanās!"></label>
          <label class="field full"><span>Adrese</span><input class="input" name="address" value="${esc(s.address)}"></label>
          <label class="field"><span>E-pasts</span><input class="input" name="email" type="email" value="${esc(s.email)}"></label>
          <label class="field"><span>Instagram</span><input class="input" name="instagram" placeholder="lietotajvards" value="${esc(s.instagram)}"></label>
          <label class="field"><span>Facebook saite</span><input class="input" name="facebook" placeholder="https://www.facebook.com/tava-lapa" value="${esc(s.facebook || '')}"></label>
          <label class="field full"><span>WhatsApp saite <span class="muted">(poga mājaslapas stūrī; tukšs — nerāda)</span></span><input class="input" name="whatsapp" type="url" placeholder="https://wa.me/37120000000" value="${esc(s.whatsapp || '')}"></label>
          <div class="full"><button class="btn" type="submit">Saglabāt</button></div></form></section>
      <section class="glass card span-5"><div class="card-head"><h3>Pierakstu noteikumi</h3></div>
        <form id="rulesForm" class="form-grid">
          <label class="field"><span>Laika solis</span><select class="input" name="slotStep">${[5, 10, 15, 20, 30, 60].map(v => `<option value="${v}" ${+s.slotStep === v ? 'selected' : ''}>${v} min</option>`).join('')}</select></label>
          <label class="field"><span>Pieraksts vismaz (h) iepriekš</span><input class="input" type="number" min="0" name="minAdvanceHours" value="${s.minAdvanceHours}"></label>
          <label class="field"><span>Atcelt/pārcelt līdz (h)</span><input class="input" type="number" min="0" name="cancelHours" value="${s.cancelHours}"></label>
          <label class="field"><span>Pieraksts uz priekšu (dienas)</span><input class="input" type="number" min="1" name="bookingDaysAhead" value="${s.bookingDaysAhead}"></label>
          <label class="field full"><span>Maks. aktīvo pierakstu skaits klientam</span><input class="input" type="number" min="1" max="20" name="maxActiveBookings" value="${s.maxActiveBookings}"></label>
          <label class="switch full"><input type="checkbox" name="allowGuestBooking" ${s.allowGuestBooking !== false ? 'checked' : ''}><span class="track"></span>Var pieteikties bez konta (vārds + tālrunis)</label>
          <label class="switch full"><input type="checkbox" name="allowRegistration" ${s.allowRegistration ? 'checked' : ''}><span class="track"></span>Klienti var paši izveidot kontu</label>
          <div class="full"><button class="btn" type="submit">Saglabāt noteikumus</button></div></form></section>
      <section class="glass card span-7"><div class="card-head"><div><h3>Administratora konts</h3><p class="muted small">Ar šiem datiem tu pieslēdzies admin panelim.</p></div></div>
        <form id="adminForm" class="form-grid">
          <label class="field full"><span>Lietotājvārds</span><input class="input" name="username" value="${esc(me.username)}" required autocapitalize="none"></label>
          <label class="field"><span>Pašreizējā parole</span><input class="input" type="password" name="current" autocomplete="current-password" required></label>
          <label class="field"><span>Jaunā parole</span><input class="input" type="password" name="next" minlength="6" autocomplete="new-password" required></label>
          <div class="full"><button class="btn" type="submit">${icon('key')}Atjaunot pieejas datus</button></div></form></section>
      <section class="glass card span-5"><div class="card-head"><div><h3>Dati</h3><p class="muted small">Regulāri lejupielādē rezerves kopiju.</p></div></div>
        <div style="display:grid;gap:10px">
          <a class="btn btn-line" href="/api/admin/backup">${icon('download')}Rezerves kopija (JSON)</a>
          <a class="btn btn-line" href="/api/admin/export/bookings.csv">${icon('download')}Pieraksti Excel formātā (CSV)</a>
        </div></section>
      <section class="glass card span-12" id="smsCard"></section></div>`;
    renderSmsCard();
    const setAboutPhoto = async url => {
      // nesaglabātās izmaiņas formās saglabājas arī pēc foto maiņas
      const keep = $$('form[id]', view).map(f => [f.id, $$('[name]', f).filter(el => el.type !== 'file' && el.type !== 'password').map(el => [el.name, el.type === 'checkbox' ? el.checked : el.value])]);
      try {
        settings = (await API.put('/api/admin/settings', { aboutPhoto: url })).settings;
        await renderSettings();
        for (const [id, vals] of keep) { const f = document.getElementById(id); if (!f) continue; for (const [n, v] of vals) { const el = f.elements[n]; if (el) el.type === 'checkbox' ? (el.checked = v) : (el.value = v); } }
        toast(url ? 'Foto atjaunināts.' : 'Foto noņemts.');
      } catch (x) { toast(x.message, 'error'); }
    };
    $('#aboutPhotoIn').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      const lbl = e.target.closest('label'); lbl.style.opacity = .6;
      try { const img = await prepareImage(f, 1400); const up = await uploadImage(img.blob); await setAboutPhoto(up.url); }
      catch (x) { toast(x.message, 'error'); lbl.style.opacity = 1; }
    });
    if ($('#aboutPhotoReset')) $('#aboutPhotoReset').addEventListener('click', () => setAboutPhoto('/img/lasma.jpg'));
    if ($('#aboutPhotoHide')) $('#aboutPhotoHide').addEventListener('click', async () => {
      const custom = /^\/uploads\//.test(settings.aboutPhoto || '');
      if (!await confirmDialog(custom ? 'Foto vairs netiks rādīts sadaļā „Par mani”, un augšupielādētais attēls tiks izdzēsts. Sākotnējo foto vienmēr var atjaunot.' : 'Foto vairs netiks rādīts sadaļā „Par mani”. To vienmēr var atjaunot ar pogu „Atjaunot sākotnējo”.', { title: 'Noņemt foto?', ok: 'Noņemt' })) return;
      setAboutPhoto('');
    });
    $('#infoForm').addEventListener('submit', async e => {
      e.preventDefault();
      await withBusy(e.submitter, async () => {
        try { settings = (await API.put('/api/admin/settings', formData(e.target))).settings; $('#brand').innerHTML = brandHTML(); $('#brandMobile').innerHTML = brandHTML(); toast('Saglabāts.'); } catch (x) { toast(x.message, 'error'); }
      });
    });
    $('#rulesForm').addEventListener('submit', async e => {
      e.preventDefault();
      await withBusy(e.submitter, async () => {
        try { settings = (await API.put('/api/admin/settings', formData(e.target))).settings; toast('Noteikumi saglabāti.'); } catch (x) { toast(x.message, 'error'); }
      });
    });
    $('#adminForm').addEventListener('submit', async e => {
      e.preventDefault();
      await withBusy(e.submitter, async () => {
        try { me = (await API.post('/api/password', formData(e.target))).user; renderMe(); e.target.current.value = ''; e.target.next.value = ''; toast('Pieejas dati atjaunoti.'); } catch (x) { toast(x.message, 'error'); }
      });
    });
  }

  /* ----------------------------------------------------------- ATTĒLI */
  // Samazina attēlu pārlūkā (līdz max px garākajā malā) un pārkodē JPG — tas arī noņem GPS un citus metadatus.
  async function prepareImage(file, max) {
    if (file.size > 40e6) throw new Error('Fails ir pārāk liels (virs 40 MB).');
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch {
      src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Šo attēla formātu pārlūks nevar atvērt (piem., HEIC). Saglabā to kā JPG un mēģini vēlreiz.')); im.src = URL.createObjectURL(file); });
    }
    const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
    const k = Math.min(1, max / Math.max(w0, h0));
    const w = Math.round(w0 * k), h = Math.round(h0 * k);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, 0, 0, w, h);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .86));
    if (!blob) throw new Error('Neizdevās apstrādāt attēlu.');
    return { blob, w, h };
  }
  async function uploadImage(blob) {
    const r = await fetch('/api/admin/uploads', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob, credentials: 'same-origin' });
    let j = null; try { j = await r.json(); } catch { /* */ }
    if (!r.ok) throw new Error((j && j.error) || 'Augšupielāde neizdevās.');
    return j;
  }
  async function uploadBoth(file) { // pilnais izmērs + sīktēls
    const full = await prepareImage(file, 1800), thumb = await prepareImage(file, 700);
    const [a, b] = await Promise.all([uploadImage(full.blob), uploadImage(thumb.blob)]);
    return { full: a.url, thumb: b.url, w: full.w, h: full.h };
  }

  /* ----------------------------------------------------------- GALERIJA */
  let galMode = 'single';
  async function renderGallery() {
    let items = [];
    try { items = (await API.get('/api/admin/gallery')).items; } catch (e) { return toast(e.message, 'error'); }
    if (location.hash !== '#galerija') return; // lietotājs pa to laiku atvēra citu sadaļu
    const cats = [...new Set([...items.map(i => i.category).filter(Boolean), ...services.map(s => s.name)])];
    const drop = (id, label) => `<label class="drop" id="${id}"><span class="lbl chip">${label}</span>${icon('upload')}<span><b>Izvēlies bildi</b><br><span class="small muted">vai ievelc to šeit</span></span><input type="file" accept="image/*"></label>`;
    view.innerHTML = pageHead('Mani darbi', 'Galerija', `<a class="btn btn-line" href="/galerija" target="_blank" rel="noopener">${icon('eye')}Skatīt galeriju</a>`) + `
      <div class="dash-grid">
        <section class="glass card span-5"><div class="card-head"><div><h3>Pievienot darbu</h3><p class="muted small">Bildes tiek samazinātas un no tām tiek noņemti metadati (piem., atrašanās vieta).</p></div></div>
          <div class="seg" id="galMode" style="margin-bottom:16px"><button type="button" data-m="single" class="${galMode === 'single' ? 'on' : ''}">Viena bilde</button><button type="button" data-m="pair" class="${galMode === 'pair' ? 'on' : ''}">Pirms un pēc</button></div>
          <form id="galForm" style="display:grid;gap:14px">
            <div style="display:grid;grid-template-columns:${galMode === 'pair' ? '1fr 1fr' : '1fr'};gap:12px">
              ${galMode === 'pair' ? drop('dropBefore', 'Pirms') + drop('dropAfter', 'Pēc') : drop('dropMain', 'Bilde')}
            </div>
            <label class="field"><span>Apraksts <span class="muted">(nav obligāts)</span></span><input class="input" name="caption" maxlength="160" placeholder="Piem., Balayage gariem matiem"></label>
            <label class="field"><span>Kategorija <span class="muted">(filtram galerijā)</span></span><input class="input" name="category" maxlength="40" list="galCats" placeholder="Piem., Krāsošana"></label>
            <datalist id="galCats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
            <label class="switch"><input type="checkbox" name="visible" checked><span class="track"></span>Rādīt galerijā uzreiz</label>
            <button class="btn btn-accent" type="submit">${icon('upload')}Augšupielādēt</button>
          </form></section>
        <section class="glass card span-7"><div class="card-head"><div><h3>Galerijā (${items.length})</h3><p class="muted small">Secību maini ar bultiņām — pirmās 4 redzamas sākumlapā.</p></div></div>
          ${items.length ? `<div class="adm-gallery">${items.map((it, i) => `
            <div class="adm-g ${it.visible ? '' : 'hidden-item'}" data-id="${esc(it.id)}">
              <div class="media ${it.type === 'pair' ? 'split' : ''}">${it.type === 'pair' ? `<img src="${esc(it.beforeThumb)}" alt="Pirms"><img src="${esc(it.thumb)}" alt="Pēc">` : `<img src="${esc(it.thumb)}" alt="">`}</div>
              <div class="body">
                <b>${esc(it.caption || (it.type === 'pair' ? 'Pirms / pēc' : 'Bez apraksta'))}</b>
                <span class="small muted">${[it.category, it.type === 'pair' ? 'pirms / pēc' : '', it.visible ? '' : 'paslēpts'].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</span>
                <div class="acts">
                  <button class="icon-btn" data-up="${i}" ${i === 0 ? 'disabled style="opacity:.35"' : ''} aria-label="Pārvietot uz priekšu" title="Uz priekšu">${icon('arrowUp')}</button>
                  <button class="icon-btn" data-down="${i}" ${i === items.length - 1 ? 'disabled style="opacity:.35"' : ''} aria-label="Pārvietot atpakaļ" title="Atpakaļ">${icon('arrowDown')}</button>
                  <button class="icon-btn" data-edit="${esc(it.id)}" aria-label="Labot" title="Labot">${icon('edit')}</button>
                  <button class="icon-btn" data-vis="${esc(it.id)}" aria-label="${it.visible ? 'Paslēpt' : 'Rādīt'}" title="${it.visible ? 'Paslēpt' : 'Rādīt'}">${icon(it.visible ? 'eyeOff' : 'eye')}</button>
                  <button class="icon-btn" data-del="${esc(it.id)}" aria-label="Dzēst" title="Dzēst" style="color:var(--bad)">${icon('trash')}</button>
                </div></div></div>`).join('')}</div>`
            : `<div class="empty">${icon('image')}<p>Galerija vēl ir tukša.<br>Pievieno pirmo darbu — tas parādīsies arī sākumlapā.</p></div>`}
        </section></div>`;

    $$('#galMode button').forEach(b => b.addEventListener('click', () => { galMode = b.dataset.m; renderGallery(); }));
    const files = {};
    $$('#galForm .drop').forEach(d => {
      const inp = $('input', d);
      const setFile = f => {
        if (!f) return;
        files[d.id] = f;
        let img = $('img.prev', d); if (!img) { img = document.createElement('img'); img.className = 'prev'; img.alt = ''; d.insertBefore(img, inp); }
        img.src = URL.createObjectURL(f);
      };
      inp.addEventListener('change', () => setFile(inp.files[0]));
      d.addEventListener('dragover', e => { e.preventDefault(); d.classList.add('over'); });
      d.addEventListener('dragleave', () => d.classList.remove('over'));
      d.addEventListener('drop', e => { e.preventDefault(); d.classList.remove('over'); setFile(e.dataTransfer.files[0]); });
    });
    $('#galForm').addEventListener('submit', async e => {
      e.preventDefault();
      const v = formData(e.target);
      const need = galMode === 'pair' ? ['dropBefore', 'dropAfter'] : ['dropMain'];
      if (need.some(k => !files[k])) return toast(galMode === 'pair' ? 'Izvēlies abas bildes — pirms un pēc.' : 'Izvēlies bildi.', 'error');
      await withBusy(e.submitter, async () => {
        try {
          let payload;
          if (galMode === 'pair') {
            const [b, a] = await Promise.all([uploadBoth(files.dropBefore), uploadBoth(files.dropAfter)]);
            payload = { type: 'pair', full: a.full, thumb: a.thumb, w: a.w, h: a.h, beforeFull: b.full, beforeThumb: b.thumb };
          } else {
            const a = await uploadBoth(files.dropMain);
            payload = { type: 'single', full: a.full, thumb: a.thumb, w: a.w, h: a.h };
          }
          await API.post('/api/admin/gallery', { ...payload, caption: v.caption, category: v.category, visible: v.visible });
          for (const k of Object.keys(files)) delete files[k]; // otrs klikšķis vairs neko neaugšupielādē
          toast('Darbs pievienots galerijai.');
          await renderGallery();
        } catch (x) { toast(x.message, 'error'); }
      });
    });
    const move = async (i, d) => {
      const ids = items.map(x => x.id); const j = i + d;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      try { await API.post('/api/admin/gallery/order', { ids }); renderGallery(); } catch (x) { toast(x.message, 'error'); }
    };
    $$('[data-up]').forEach(b => b.addEventListener('click', () => move(+b.dataset.up, -1)));
    $$('[data-down]').forEach(b => b.addEventListener('click', () => move(+b.dataset.down, 1)));
    $$('[data-vis]').forEach(b => b.addEventListener('click', async () => {
      const it = items.find(x => x.id === b.dataset.vis);
      try { await API.put(`/api/admin/gallery/${it.id}`, { visible: !it.visible }); renderGallery(); } catch (x) { toast(x.message, 'error'); }
    }));
    $$('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!await confirmDialog('Bilde tiks neatgriezeniski dzēsta no galerijas.', { title: 'Dzēst darbu?', ok: 'Dzēst', danger: true })) return;
      try { await API.del(`/api/admin/gallery/${b.dataset.del}`); toast('Dzēsts.'); renderGallery(); } catch (x) { toast(x.message, 'error'); }
    }));
    $$('[data-edit]').forEach(b => b.addEventListener('click', () => {
      const it = items.find(x => x.id === b.dataset.edit);
      const { el, close } = openModal({
        title: 'Labot darbu',
        body: `<form class="form-grid" id="galEdit">
          <label class="field full"><span>Apraksts</span><input class="input" name="caption" maxlength="160" value="${esc(it.caption)}"></label>
          <label class="field full"><span>Kategorija</span><input class="input" name="category" maxlength="40" list="galCats2" value="${esc(it.category)}"></label>
          <datalist id="galCats2">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
          <label class="switch full"><input type="checkbox" name="visible" ${it.visible ? 'checked' : ''}><span class="track"></span>Rādīt galerijā</label></form>`,
        foot: `<button class="btn btn-line" data-close>Atcelt</button><button class="btn" id="galSave">Saglabāt</button>`
      });
      $('#galSave', el).addEventListener('click', e => withBusy(e.currentTarget, async () => {
        try { await API.put(`/api/admin/gallery/${it.id}`, formData($('#galEdit', el))); toast('Saglabāts.'); close(); renderGallery(); } catch (x) { toast(x.message, 'error'); }
      }));
    }));
  }

  /* ----------------------------------------------------------- SMS PAZIŅOJUMI */
  const SMS_TYPES = { confirm: 'Apstiprinājums klientam', change: 'Pārcelšana klientam', cancel: 'Atcelšana klientam', reminder: 'Atgādinājums klientam',
    'owner-new': 'Jauns pieraksts (tev)', 'owner-change': 'Pārcelts (tev)', 'owner-cancel': 'Atcelts (tev)', test: 'Testa SMS' };
  const SMS_STATUS = { sent: ['completed', 'Nosūtīta'], test: ['booked', 'Testa režīms'], failed: ['noshow', 'Kļūda'], unknown: ['noshow', 'Nav zināms'], skipped: ['cancelled', 'Izlaista'] };

  async function renderSmsCard() {
    const box = $('#smsCard'); if (!box) return;
    const c = settings.sms || {}, cs = c.credsSet || {}, o = c.owner || {}, cl = c.client || {};
    let logData = { log: [], month: { messages: 0, segments: 0 } };
    try { logData = await API.get('/api/admin/sms/log'); } catch { /* */ }
    const state = !c.provider ? ['cancelled', 'Izslēgti'] : c.provider === 'log' ? ['booked', 'Testa režīms — SMS netiek sūtītas'] : ['completed', 'Ieslēgti'];
    const chk = (name, on, label) => `<label class="switch"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}><span class="track"></span>${label}</label>`;
    const secret = (name, set, label, ph) => `<label class="field"><span>${label}</span><input class="input" type="password" name="${name}" autocomplete="off" placeholder="${set ? '•••••• saglabāts — atstāj tukšu, lai nemainītu' : esc(ph)}"></label>`;
    box.innerHTML = `
      <div class="card-head"><div><h3>SMS paziņojumi</h3><p class="muted small">Apstiprinājumi un atgādinājumi klientiem, paziņojumi tev par jauniem, pārceltiem un atceltiem pierakstiem.</p></div>
        <span class="badge ${state[0]}">${state[1]}</span></div>
      <form id="smsForm" class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))" autocomplete="off">
        <label class="field"><span>SMS pakalpojums</span><select class="input" name="provider">
          <option value="" ${!c.provider ? 'selected' : ''}>Izslēgts</option>
          <option value="sendberry" ${c.provider === 'sendberry' ? 'selected' : ''}>Sendberry (Latvija, ieteicams)</option>
          <option value="twilio" ${c.provider === 'twilio' ? 'selected' : ''}>Twilio</option>
          <option value="smsapi" ${c.provider === 'smsapi' ? 'selected' : ''}>SMSAPI</option>
          <option value="log" ${c.provider === 'log' ? 'selected' : ''}>Testa režīms (nesūta, tikai žurnālā)</option></select></label>
        <label class="field"><span>Sūtītāja vārds</span><input class="input" name="sender" maxlength="15" value="${esc(c.sender || '')}" placeholder="LDStudio"></label>
        <label class="field"><span>Tavs mobilais (paziņojumiem tev)</span><input class="input" name="ownerPhone" type="tel" value="${esc(c.ownerPhone || '')}" placeholder="+371 2…"></label>
        <div class="full prov prov-sendberry" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
          ${secret('sendberryKey', cs.sendberryKey, 'Sendberry API key', '')}${secret('sendberryName', cs.sendberryName, 'Sendberry API name', '')}${secret('sendberryPassword', cs.sendberryPassword, 'Sendberry API password', '')}
          <p class="tiny muted" style="grid-column:1/-1">Sendberry portālā: API sadaļā izveido atslēgu — tur būs key, name un password. Sūtītāja vārdu (piem., „LDStudio”) vispirms jāreģistrē un jāapstiprina Sendberry portālā; kamēr tas nav apstiprināts, atstāj lauku „Sūtītāja vārds” tukšu.</p></div>
        <div class="full prov prov-twilio" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">
          ${secret('twilioSid', cs.twilioSid, 'Twilio Account SID', 'AC…')}${secret('twilioToken', cs.twilioToken, 'Twilio Auth Token', '')}</div>
        <div class="full prov prov-smsapi" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">
          ${secret('smsapiToken', cs.smsapiToken, 'SMSAPI OAuth tokens', '')}</div>
        <div class="field"><span>Tev (frizierei)</span><div style="display:grid;gap:8px">
          ${chk('o_onNew', o.onNew, 'Jauns pieraksts')}${chk('o_onChange', o.onChange, 'Klients pārcēla')}${chk('o_onCancel', o.onCancel, 'Klients atcēla')}</div></div>
        <div class="field"><span>Klientam</span><div style="display:grid;gap:8px">
          ${chk('c_confirm', cl.confirm, 'Apstiprinājums pēc pieteikšanās')}${chk('c_change', cl.change, 'Paziņojums par pārcelšanu')}${chk('c_cancel', cl.cancel, 'Paziņojums par atcelšanu')}
          ${chk('c_onAdminChanges', cl.onAdminChanges, 'Arī par manām izmaiņām admin panelī')}</div></div>
        <div class="field"><span>Atgādinājums</span><div style="display:grid;gap:8px">
          ${chk('c_reminder', cl.reminder, 'Sūtīt atgādinājumu pirms vizītes')}
          <label style="display:flex;align-items:center;gap:8px;font-size:14px"><input class="input" type="number" name="reminderHours" min="2" max="72" value="${cl.reminderHours || 24}" style="width:84px;height:38px"> h pirms vizītes</label>
          <span class="tiny muted">Naktī (21:00–8:00) atgādinājumi netiek sūtīti.</span></div></div>
        <div class="field"><span>Teksts</span><div style="display:grid;gap:8px">${chk('ascii', c.ascii !== false, 'Bez garumzīmēm (1 SMS = 160 zīmes)')}
          <span class="tiny muted">Ar garumzīmēm vienā SMS ietilpst tikai 70 zīmes — apstiprinājums aizņemtu 2–3 SMS.</span></div></div>
        <div class="full" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <button class="btn" type="submit">Saglabāt SMS iestatījumus</button>
          ${Object.values(cs).some(Boolean) ? '<button class="btn btn-sm btn-danger" type="button" id="smsClear">Dzēst saglabātās atslēgas</button>' : ''}
        </div>
      </form>
      <hr style="border:0;border-top:1px solid var(--line);margin:22px 0">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
        <label class="field" style="flex:1;min-width:200px"><span>Testa SMS uz numuru</span><input class="input" id="smsTestTo" type="tel" placeholder="${esc(c.ownerPhone || '+371 2…')}"></label>
        <button class="btn btn-sage" type="button" id="smsTest">Sūtīt testa SMS</button>
      </div>
      <div class="card-head" style="margin:24px 0 8px"><h3 style="font-size:15px">Pēdējās SMS</h3><span class="muted small">Šomēnes nosūtītas: <b>${logData.month.messages}</b> (${logData.month.segments} SMS daļas)</span></div>
      <div class="table-wrap" style="max-height:320px;overflow:auto">${logData.log.length ? `<table class="table"><thead><tr><th>Laiks</th><th>Veids</th><th>Numurs</th><th>Statuss</th><th>Piezīme</th></tr></thead><tbody>
        ${logData.log.map(e => { const st = SMS_STATUS[e.status] || ['cancelled', e.status]; return `<tr><td style="white-space:nowrap">${fmt.dateShort(dateStr(new Date(e.at)))} ${new Date(e.at).toTimeString().slice(0, 5)}</td>
          <td>${esc(SMS_TYPES[e.type] || e.type)}</td><td style="font-variant-numeric:tabular-nums">${esc(e.to || '')}</td><td><span class="badge ${st[0]}">${esc(st[1])}</span></td>
          <td class="small muted" style="max-width:360px">${esc(e.error || e.text || (e.segments > 1 ? e.segments + ' SMS daļas' : ''))}</td></tr>`; }).join('')}</tbody></table>`
        : '<p class="muted small">Vēl nav nosūtīta neviena SMS.</p>'}</div>`;

    const f = $('#smsForm');
    const syncProv = () => $$('.prov', box).forEach(el => el.classList.toggle('hidden', !el.classList.contains('prov-' + f.provider.value)));
    syncProv(); f.provider.addEventListener('change', syncProv);
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const v = formData(f);
      const payload = { sms: {
        provider: v.provider, sender: v.sender, ownerPhone: v.ownerPhone, ascii: v.ascii,
        owner: { onNew: v.o_onNew, onChange: v.o_onChange, onCancel: v.o_onCancel },
        client: { confirm: v.c_confirm, change: v.c_change, cancel: v.c_cancel, reminder: v.c_reminder, onAdminChanges: v.c_onAdminChanges, reminderHours: v.reminderHours },
        creds: { sendberryKey: v.sendberryKey || '', sendberryName: v.sendberryName || '', sendberryPassword: v.sendberryPassword || '', twilioSid: v.twilioSid || '', twilioToken: v.twilioToken || '', smsapiToken: v.smsapiToken || '' } } };
      await withBusy(e.submitter, async () => {
        try { settings = (await API.put('/api/admin/settings', payload)).settings; toast('SMS iestatījumi saglabāti.'); renderSmsCard(); } catch (x) { toast(x.message, 'error'); }
      });
    });
    if ($('#smsClear')) $('#smsClear').addEventListener('click', async () => {
      if (!await confirmDialog('Dzēst saglabātās SMS pakalpojuma atslēgas? SMS netiks sūtītas, kamēr neievadīsi jaunas.', { title: 'Dzēst atslēgas?', ok: 'Dzēst', danger: true })) return;
      try { settings = (await API.put('/api/admin/settings', { sms: { clearCreds: true } })).settings; toast('Atslēgas dzēstas.'); renderSmsCard(); } catch (x) { toast(x.message, 'error'); }
    });
    $('#smsTest').addEventListener('click', e => withBusy(e.currentTarget, async () => {
      try {
        const r = await API.post('/api/admin/sms/test', { to: $('#smsTestTo').value });
        toast(settings.sms && settings.sms.provider === 'log' ? 'Testa režīms: SMS ierakstīta žurnālā (netika sūtīta).' : 'Testa SMS nosūtīta.');
        renderSmsCard();
      } catch (x) { toast(x.message, 'error'); renderSmsCard(); }
    }));
  }

  route();
})();
