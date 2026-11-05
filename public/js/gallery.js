/* Galerija: filtri, pirms/pēc salīdzinājums ar slīdni, pilnekrāna skats */
'use strict';

// Pirms/pēc salīdzinājums. Slīdnis ir īsts <input type=range> — strādā ar peli, pirkstu un tastatūru.
function compareHTML(it, big = false) {
  const before = big ? it.beforeFull : it.beforeThumb, after = big ? it.full : it.thumb;
  const ar = big && it.w && it.h ? `;--ar:${+it.w}/${+it.h}` : '';
  return `<div class="compare" style="--p:50${ar}">
    <img class="after" src="${esc(after)}" alt="Pēc${it.caption ? ': ' + esc(it.caption) : ''}" ${big ? '' : 'loading="lazy"'} decoding="async">
    <img class="before" src="${esc(before)}" alt="Pirms" ${big ? '' : 'loading="lazy"'} decoding="async">
    <span class="tag l">Pirms</span><span class="tag r">Pēc</span>
    <input type="range" min="0" max="100" value="50" aria-label="Salīdzināt: pirms un pēc">
    <span class="line"></span><span class="knob">${icon('arrowsH')}</span></div>`;
}
function bindCompare(root) {
  $$('.compare input[type=range]', root).forEach(r => {
    const c = r.closest('.compare');
    const set = () => c.style.setProperty('--p', r.value);
    r.addEventListener('input', set);
    r.addEventListener('click', e => e.stopPropagation());
    set();
  });
}

(async () => {
  let info = null, items = [];
  try { [info, items] = await Promise.all([API.get('/api/public'), API.get('/api/gallery').then(r => r.items)]); }
  catch (e) { $('#grid').innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
  const S = info.settings;
  document.title = `Mani darbi — ${S.salonName}`;
  $('#brand').innerHTML = `${BRAND_MARK}<span>${esc(S.salonName)}</span>`;
  if (typeof whatsappButton === 'function') whatsappButton(S.whatsapp);
  if (S.allowGuestBooking === false) $$('a[href="/pieteikties"]').forEach(a => { a.href = '/pieslegties'; });

  const PAIRS = '__pairs__';
  const cats = [...new Set(items.map(i => i.category).filter(Boolean))];
  const hasPairs = items.some(i => i.type === 'pair');
  let filter = '';
  let shown = items;

  function renderFilters() {
    const opts = [['', 'Visi'], ...(hasPairs ? [[PAIRS, 'Pirms un pēc']] : []), ...cats.map(c => [c, c])];
    $('#filters').innerHTML = opts.length > 2 || (opts.length === 2 && cats.length) ? opts.map(([v, l]) => `<button type="button" data-f="${esc(v)}" aria-pressed="${v === filter}">${esc(l)}</button>`).join('') : '';
    $$('#filters [data-f]').forEach(b => b.addEventListener('click', () => { filter = b.dataset.f; renderFilters(); renderGrid(); }));
  }

  function renderGrid() {
    shown = items.filter(i => !filter || (filter === PAIRS ? i.type === 'pair' : i.category === filter));
    if (!items.length) {
      $('#grid').innerHTML = `<div class="empty" style="grid-column:1/-1">${icon('image')}<p>Galerija drīzumā tiks papildināta.</p><p style="margin-top:12px"><a class="btn btn-accent" href="/pieteikties">Pieteikties vizītei</a></p></div>`;
      return;
    }
    $('#grid').innerHTML = shown.map((it, i) => `
      <figure class="g-card" id="d-${esc(it.id)}">
        <div class="g-media">
          ${it.type === 'pair' ? compareHTML(it) : `<img src="${esc(it.thumb)}" alt="${esc(it.caption || 'Darbs')}" loading="lazy" decoding="async">`}
          ${it.type === 'pair' ? '' : `<button type="button" class="g-open" data-i="${i}" aria-label="Atvērt lielāku${it.caption ? ': ' + esc(it.caption) : ''}"></button>`}
        </div>
        ${it.caption || it.category || it.type === 'pair' ? `<figcaption>
          ${it.caption ? `<b>${esc(it.caption)}</b>` : ''}
          <span>${[it.category, it.type === 'pair' ? 'pirms / pēc' : ''].filter(Boolean).map(esc).join(' · ')}
            ${it.type === 'pair' ? ` · <a href="#" data-i="${i}" class="g-zoom" style="color:var(--accent);font-weight:600">palielināt</a>` : ''}</span>
        </figcaption>` : ''}
      </figure>`).join('') || '<p class="muted" style="grid-column:1/-1">Šajā kategorijā vēl nav darbu.</p>';
    bindCompare($('#grid'));
    $$('#grid [data-i]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); openLightbox(+el.dataset.i); }));
  }

  /* ---------- pilnekrāna skats ---------- */
  let lb = null, cur = 0, lastFocus = null;
  function openLightbox(i) {
    lastFocus = document.activeElement;
    cur = i;
    lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true'); lb.setAttribute('aria-label', 'Darbu skatītājs');
    lb.innerHTML = `<div class="lb-stage"></div><div class="lb-cap" aria-live="polite"></div>
      <button class="lb-btn lb-close" aria-label="Aizvērt">${icon('x')}</button>
      ${shown.length > 1 ? `<button class="lb-btn lb-prev" aria-label="Iepriekšējais">${icon('chevL')}</button><button class="lb-btn lb-next" aria-label="Nākamais">${icon('chevR')}</button>` : ''}`;
    document.body.appendChild(lb);
    document.body.style.overflow = 'hidden'; document.body.classList.add('lb-open');
    $('.lb-close', lb).addEventListener('click', closeLightbox);
    if ($('.lb-prev', lb)) { $('.lb-prev', lb).addEventListener('click', () => step(-1)); $('.lb-next', lb).addEventListener('click', () => step(1)); }
    lb.addEventListener('click', e => { if (e.target === lb || e.target.classList.contains('lb-stage')) closeLightbox(); });
    let x0 = null;
    lb.addEventListener('touchstart', e => { if (!e.target.closest('.compare')) x0 = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1); });
    document.addEventListener('keydown', onKey);
    showCurrent();
    $('.lb-close', lb).focus();
  }
  function showCurrent() {
    const it = shown[cur];
    $('.lb-stage', lb).innerHTML = it.type === 'pair' ? compareHTML(it, true) : `<img src="${esc(it.full)}" alt="${esc(it.caption || 'Darbs')}">`;
    bindCompare(lb);
    $('.lb-cap', lb).innerHTML = `${esc(it.caption || '')}${it.category ? `<span>${esc(it.category)}</span>` : ''}${shown.length > 1 ? `<span>${cur + 1} / ${shown.length}</span>` : ''}`;
  }
  function step(d) { cur = (cur + d + shown.length) % shown.length; showCurrent(); }
  function onKey(e) {
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowRight' && !e.target.matches('input[type=range]')) step(1);
    else if (e.key === 'ArrowLeft' && !e.target.matches('input[type=range]')) step(-1);
    else if (e.key === 'Tab') { // fokuss paliek skatītājā
      const f = $$('button, input', lb); if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  }
  function closeLightbox() {
    if (!lb) return;
    document.removeEventListener('keydown', onKey);
    lb.remove(); lb = null;
    document.body.style.overflow = ''; document.body.classList.remove('lb-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  renderFilters();
  renderGrid();
  // saite no sākumlapas: /galerija#d-<id> → atver to darbu
  const target = location.hash.startsWith('#d-') ? location.hash.slice(3) : '';
  const idx = target ? shown.findIndex(i => i.id === target) : -1;
  if (idx >= 0) { const el = document.getElementById('d-' + target); if (el) el.scrollIntoView({ block: 'center' }); openLightbox(idx); }
})();
