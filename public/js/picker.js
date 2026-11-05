/* Kopīgā datuma un laika izvēle (izmanto klienta konts un pieteikšanās bez konta).
   Rāda tikai dienas un laikus, kuros izvēlētais pakalpojums tiešām ir brīvs. */
'use strict';

function createDateTimePicker(root, { service, daysAhead = 60, excludeId = null, month, date = null, start = null, onChange = () => {} }) {
  const st = { month: month || (date || todayStr()).slice(0, 7), date, start, days: {} };
  if (st.month < todayStr().slice(0, 7)) st.month = todayStr().slice(0, 7);
  root.innerHTML = `<div class="picker">
    <div class="cal" data-cal><div class="skeleton" style="height:300px"></div></div>
    <div data-slots></div></div>`;
  const calEl = $('[data-cal]', root), slotsEl = $('[data-slots]', root);
  const q = extra => { const p = new URLSearchParams({ serviceId: service.id, ...extra }); if (excludeId) p.set('exclude', excludeId); return p; };
  const emit = () => onChange({ date: st.date, start: st.start, month: st.month });

  async function loadDays() {
    st.days = (await API.get('/api/days?' + q({ month: st.month }))).days;
  }

  function renderCalendar() {
    const [y, m] = st.month.split('-').map(Number);
    const first = new Date(y, m - 1, 1), lastDay = new Date(y, m, 0).getDate();
    const lead = (first.getDay() + 6) % 7;
    const t = todayStr();
    const maxMonth = addDays(t, daysAhead).slice(0, 7);
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span></span>';
    for (let d = 1; d <= lastDay; d++) {
      const ds = `${st.month}-${pad(d)}`, n = st.days[ds] || 0;
      const cls = ['cal-day', n ? 'avail' : 'off', n && n <= 3 ? 'few' : '', ds === t ? 'today' : '', ds === st.date ? 'on' : ''].join(' ');
      cells += `<button type="button" class="${cls}" ${n ? `data-day="${ds}"` : 'disabled'} aria-pressed="${ds === st.date}" aria-label="${fmt.dateLong(ds)}${n ? `, ${n} brīvi laiki` : ', nav brīvu laiku'}">${d}</button>`;
    }
    const anyFree = Object.values(st.days).some(Boolean);
    calEl.innerHTML = `<div class="cal-head">
        <button type="button" class="icon-btn" data-prev ${st.month <= t.slice(0, 7) ? 'disabled style="opacity:.35"' : ''} aria-label="Iepriekšējais mēnesis">${icon('chevL')}</button>
        <b>${LV.months[m - 1]} ${y}</b>
        <button type="button" class="icon-btn" data-next ${st.month >= maxMonth ? 'disabled style="opacity:.35"' : ''} aria-label="Nākamais mēnesis">${icon('chevR')}</button></div>
      <div class="cal-grid">${['P', 'O', 'T', 'C', 'Pk', 'S', 'Sv'].map(d => `<span class="wd">${d}</span>`).join('')}${cells}</div>
      <div class="cal-legend"><span><i class="dot" style="background:var(--secondary);width:6px;height:6px"></i>Ir brīvi laiki</span><span><i class="dot" style="background:var(--accent);width:6px;height:6px"></i>Pēdējās vietas</span></div>
      ${anyFree ? '' : `<p class="muted small" style="margin-top:10px">Šajā mēnesī brīvu laiku vairs nav${st.month < maxMonth ? ' — apskati nākamo mēnesi' : ''}.</p>`}`;
    const shift = async k => {
      const d = new Date(y, m - 1 + k, 1);
      st.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      calEl.style.opacity = .5;
      try { await loadDays(); } catch (e) { toast(e.message, 'error'); }
      calEl.style.opacity = 1;
      renderCalendar();
    };
    $('[data-prev]', calEl).addEventListener('click', () => shift(-1));
    $('[data-next]', calEl).addEventListener('click', () => shift(1));
    $$('[data-day]', calEl).forEach(b => b.addEventListener('click', () => {
      st.date = b.dataset.day; st.start = null;
      renderCalendar(); emit();
      // šaurā ekrānā laiki ir zem kalendāra — parāda tos
      renderSlots().then(() => { if (matchMedia('(max-width: 720px)').matches) slotsEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    }));
  }

  async function renderSlots() {
    if (!st.date) {
      slotsEl.innerHTML = `<div class="empty" style="padding-top:60px">${icon('calendar')}<p>Izvēlies datumu kalendārā,<br>lai redzētu brīvos laikus.</p>
        <p class="small" style="margin-top:12px">${esc(service.name)} · ${fmt.dur(service.duration)}</p></div>`;
      return;
    }
    slotsEl.innerHTML = '<div class="skeleton" style="height:200px"></div>';
    let slots = [];
    try { slots = (await API.get('/api/slots?' + q({ date: st.date }))).slots; } catch (e) { toast(e.message, 'error'); }
    if (st.start && !slots.includes(st.start)) { st.start = null; emit(); }
    const groups = [['Rīts', s => toMin(s) < 720], ['Diena', s => toMin(s) >= 720 && toMin(s) < 1020], ['Vakars', s => toMin(s) >= 1020]];
    slotsEl.innerHTML = `<div style="margin-bottom:14px"><b style="font-size:16px">${fmt.dateLong(st.date)}</b><p class="muted small">${esc(service.name)} · ${fmt.dur(service.duration)}</p></div>` +
      (slots.length ? groups.map(([label, f]) => {
        const g = slots.filter(f);
        return g.length ? `<div class="slot-group"><span class="label">${label}</span><div class="slots">${g.map(s => `<button type="button" class="slot ${s === st.start ? 'on' : ''}" data-slot="${s}" aria-pressed="${s === st.start}">${s}</button>`).join('')}</div></div>` : '';
      }).join('') : '<p class="muted">Šajā dienā brīvu laiku vairs nav. Lūdzu izvēlies citu dienu.</p>');
    $$('[data-slot]', slotsEl).forEach(b => b.addEventListener('click', () => {
      st.start = b.dataset.slot;
      $$('.slot', slotsEl).forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
      emit();
    }));
  }

  (async () => {
    try { await loadDays(); } catch (e) { toast(e.message, 'error'); }
    renderCalendar();
    renderSlots();
  })();

  return { get value() { return { date: st.date, start: st.start, month: st.month }; } };
}
