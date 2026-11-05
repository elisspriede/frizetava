'use strict';
(async () => {
  const SVC_ICONS = ['scissors', 'user', 'sparkle', 'leaf', 'sparkle', 'leaf', 'scissors', 'sparkle'];
  try {
    const [info, me] = await Promise.all([API.get('/api/public'), API.get('/api/me').catch(() => ({ user: null }))]);
    const s = info.settings;
    document.title = `${s.salonName} — pieraksts tiešsaistē`;
    $('#brand').innerHTML = `${BRAND_MARK}<span>${esc(s.salonName)}</span>`;
    $('#heroEyebrow').textContent = s.salonName;
    if (s.tagline) $('#tagline').textContent = s.tagline + ' Piesakies vizītei tiešsaistē — dažos klikšķos.';
    // Par mani
    $('#about').textContent = s.about || '';
    if (s.ownerName) { $('#ownerName').textContent = s.ownerName; $('#aboutPhoto').alt = `${s.ownerName}${s.ownerTitle ? ', ' + s.ownerTitle.toLowerCase() : ''}`; }
    else $('#ownerHeading').textContent = s.salonName;
    $('#ownerTitle').textContent = s.ownerTitle || '';
    $('#ownerTitle').classList.toggle('hidden', !s.ownerTitle);
    $('#aboutQuote').textContent = s.aboutQuote || '';
    $('#aboutQuote').classList.toggle('hidden', !s.aboutQuote);
    const photo = $('#aboutPhoto');
    if (!s.aboutPhoto) photo.closest('figure').classList.add('hidden');
    else if (s.aboutPhoto !== '/img/lasma.jpg') { photo.removeAttribute('srcset'); photo.src = s.aboutPhoto; }
    // Mani darbi (tikai ja galerijā ir bildes)
    if (s.hasGallery) {
      API.get('/api/gallery').then(({ items }) => {
        if (!items.length) return;
        $('#worksThumbs').innerHTML = items.slice(0, 4).map(it => `<a href="/galerija#d-${encodeURIComponent(it.id)}" aria-label="${esc(it.caption || 'Darbs')}${it.type === 'pair' ? ' (pirms un pēc)' : ''}">
          <img src="${esc(it.thumb)}" alt="" loading="lazy" decoding="async">${it.type === 'pair' ? '<span class="ba-chip">Pirms / pēc</span>' : ''}</a>`).join('');
        $('#darbi').classList.remove('hidden');
        $('#aboutGalleryBtn').classList.remove('hidden');
      }).catch(() => {});
    }
    $('#copy').textContent = `© ${new Date().getFullYear()} ${s.salonName}`;

    // pieteikšanās: klientam — savā kontā; pārējiem — bez konta (ja atļauts)
    const bookHref = me.user && me.user.role === 'client' ? '/konts' : (s.allowGuestBooking === false ? '/pieslegties' : '/pieteikties');
    $$('a[href="/pieteikties"]').forEach(a => { a.href = bookHref; });
    if (me.user) {
      const href = me.user.role === 'admin' ? '/admin' : '/konts';
      $('#navActions').innerHTML = `<a class="btn btn-sm" href="${href}">${me.user.role === 'admin' ? 'Admin panelis' : 'Mans konts'}</a>`;
    }

    if (info.nextFree) {
      const d = info.nextFree.date, t = todayStr();
      const day = d === t ? 'Šodien' : d === addDays(t, 1) ? 'Rīt' : `${LV.daysShort[parseD(d).getDay()]}, ${fmt.dateShort(d)}`;
      $('#nextFree').textContent = `${day} ${info.nextFree.start}`;
      $('#nextFree').title = fmt.dateLong(info.nextFree.date);
    } else $('#nextFree').textContent = 'Zvani mums';

    const wd = new Date().getDay();
    const th = info.hours[wd];
    const closedToday = info.closures.some(c => c.date === todayStr());
    $('#todayHours').textContent = th && th.open && !closedToday ? `${th.start}–${th.end}` : 'Slēgts';

    $('#services').innerHTML = info.services.map((x, i) => `
      <a class="glass service" href="${bookHref}${bookHref === '/pieteikties' ? '?pakalpojums=' + encodeURIComponent(x.id) : ''}" aria-label="Pieteikties: ${esc(x.name)}">
        <div style="display:flex;justify-content:space-between;align-items:center"><div class="swatch" style="background:${esc(x.color)}">${icon(SVC_ICONS[i % SVC_ICONS.length])}</div><span class="book">Pieteikties ${icon('arrowR')}</span></div>
        <h3>${esc(x.name)}</h3>
        <p>${esc(x.description || '')}</p>
        <div class="meta"><span class="price">${fmt.money(x.price)}</span><span class="dur">${icon('clock')}${fmt.dur(x.duration)}</span></div>
      </a>`).join('') || '<p class="muted">Pakalpojumi drīzumā.</p>';

    const order = [1, 2, 3, 4, 5, 6, 0];
    $('#hours').innerHTML = order.map(d => {
      const h = info.hours[d];
      const open = h && h.open;
      return `<div class="${d === wd ? 'today' : ''} ${open ? '' : 'closed'}"><span>${cap(LV.days[d])}</span><span>${open ? `${h.start} – ${h.end}` : 'Slēgts'}</span></div>`;
    }).join('');
    if (info.closures.length) {
      $('#closures').innerHTML = 'Slēgts: ' + info.closures.slice(0, 4).map(c => `${fmt.dateShort(c.date)}${c.reason ? ` (${esc(c.reason)})` : ''}`).join(', ');
    }

    const contacts = [];
    if (s.phone) contacts.push(`<a class="glass contact" href="tel:${esc(s.phone.replace(/\s/g, ''))}"><span class="ic">${icon('phone')}</span><span><small>Tālrunis</small><b>${esc(s.phone)}</b></span></a>`);
    if (s.address) contacts.push(`<a class="glass contact" target="_blank" rel="noopener" href="https://maps.google.com/?q=${encodeURIComponent(s.address)}"><span class="ic">${icon('pin')}</span><span><small>Adrese</small><b>${esc(s.address)}</b></span></a>`);
    if (isWhatsAppUrl(s.whatsapp)) contacts.push(`<a class="glass contact" target="_blank" rel="noopener" href="${esc(s.whatsapp)}"><span class="ic wa">${WA_ICON}</span><span><small>WhatsApp</small><b>Raksti mums</b></span></a>`);
    whatsappButton(s.whatsapp);
    if (s.instagram) contacts.push(`<a class="glass contact" target="_blank" rel="noopener" href="https://instagram.com/${esc(s.instagram.replace(/^@/, ''))}"><span class="ic">${icon('insta')}</span><span><small>Instagram</small><b>@${esc(s.instagram.replace(/^@/, ''))}</b></span></a>`);
    else if (s.email) contacts.push(`<a class="glass contact" href="mailto:${esc(s.email)}"><span class="ic">${icon('mail')}</span><span><small>E-pasts</small><b>${esc(s.email)}</b></span></a>`);
    $('#contacts').innerHTML = contacts.join('');
  } catch (e) {
    toast(e.message, 'error');
  }
})();
