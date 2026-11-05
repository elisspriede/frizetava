/* Viegli SVG grafiki: gluda laukuma līkne, virtulis (donut), stabiņi. Bez ārējām bibliotēkām. */
'use strict';

const Charts = (() => {
  const NS = 'http://www.w3.org/2000/svg';

  function smoothPath(pts, floorY) {
    if (!pts.length) return '';
    if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = Math.min(floorY, p1[1] + (p2[1] - p0[1]) / 6);
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = Math.min(floorY, p2[1] - (p3[1] - p1[1]) / 6);
      d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  }

  function niceMax(v) {
    if (v <= 0) return 4;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  const observers = new WeakMap();
  function onResize(el, fn) {
    if (observers.has(el)) observers.get(el).disconnect();
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => { if (Math.abs(el.clientWidth - w) > 4) { w = el.clientWidth; fn(); } });
    ro.observe(el);
    observers.set(el, ro);
  }

  /**
   * Laukuma līkne. series: [{ values:[], color, label, fill:true }]
   */
  function area(el, { labels, series, height = 260, format = v => v, tipLabel = l => l, xTicks = 6 }) {
    const draw = () => {
      const W = Math.max(280, el.clientWidth), H = height;
      const pad = { l: 44, r: 12, t: 16, b: 30 };
      const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
      const max = niceMax(Math.max(1, ...series.flatMap(s => s.values)));
      const n = labels.length;
      const x = i => pad.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
      const y = v => pad.t + ih - (v / max) * ih;
      const floor = pad.t + ih;

      let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafiks"><defs>`;
      series.forEach((s, i) => {
        svg += `<linearGradient id="g${el.id}${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".32"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`;
      });
      svg += '</defs>';
      for (let i = 0; i <= 4; i++) {
        const v = (max / 4) * i, yy = y(v);
        svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}" stroke="rgba(46,58,47,.08)" ${i ? 'stroke-dasharray="3 5"' : ''}/>`;
        svg += `<text x="${pad.l - 10}" y="${yy + 4}" text-anchor="end" font-size="11" fill="#8a8e82">${esc(format(v, true))}</text>`;
      }
      const step = Math.max(1, Math.ceil(n / xTicks));
      labels.forEach((l, i) => {
        if (i % step && i !== n - 1) return;
        if (i !== n - 1 && n - 1 - i < step * 0.6) return;
        svg += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#8a8e82">${esc(l)}</text>`;
      });
      series.forEach((s, si) => {
        const pts = s.values.map((v, i) => [x(i), y(v)]);
        const line = smoothPath(pts, floor);
        if (s.fill !== false) svg += `<path d="${line} L${x(n - 1)},${floor} L${x(0)},${floor} Z" fill="url(#g${el.id}${si})"/>`;
        svg += `<path class="line" d="${line}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.5}" stroke-linecap="round" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>`;
      });
      svg += `<line class="cursor" x1="0" x2="0" y1="${pad.t}" y2="${floor}" stroke="rgba(46,58,47,.25)" stroke-dasharray="3 4" opacity="0"/>`;
      series.forEach((s, si) => { svg += `<circle class="pt pt${si}" r="5" fill="#fff" stroke="${s.color}" stroke-width="2.5" opacity="0"/>`; });
      svg += `<rect class="hit" x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;
      el.innerHTML = svg + '<div class="tip"></div>';
      el.style.height = H + 'px';

      const paths = el.querySelectorAll('path.line');
      paths.forEach(p => {
        const len = p.getTotalLength ? p.getTotalLength() : 0;
        if (!len || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        p.style.strokeDasharray = p.getAttribute('stroke-dasharray') || `${len}`;
        if (!p.getAttribute('stroke-dasharray')) {
          p.style.strokeDashoffset = len;
          p.getBoundingClientRect();
          p.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(.2,.8,.2,1)';
          p.style.strokeDashoffset = '0';
        }
      });

      const hit = el.querySelector('.hit'), tip = el.querySelector('.tip'), cur = el.querySelector('.cursor');
      const move = e => {
        const r = el.getBoundingClientRect();
        const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
        const i = Math.max(0, Math.min(n - 1, Math.round(((cx - pad.l) / iw) * (n - 1))));
        cur.setAttribute('x1', x(i)); cur.setAttribute('x2', x(i)); cur.setAttribute('opacity', 1);
        series.forEach((s, si) => { const c = el.querySelector('.pt' + si); c.setAttribute('cx', x(i)); c.setAttribute('cy', y(s.values[i])); c.setAttribute('opacity', 1); });
        tip.innerHTML = `<span style="opacity:.7">${esc(tipLabel(labels[i], i))}</span>` + series.map(s => `<b>${s.label ? `<span style="opacity:.7;font-weight:500">${esc(s.label)}: </span>` : ''}${esc(format(s.values[i]))}</b>`).join('');
        tip.style.left = Math.min(W - 70, Math.max(70, x(i))) + 'px';
        tip.style.top = Math.min(...series.map(s => y(s.values[i]))) + 'px';
        tip.classList.add('show');
      };
      const leave = () => { tip.classList.remove('show'); cur.setAttribute('opacity', 0); el.querySelectorAll('.pt').forEach(c => c.setAttribute('opacity', 0)); };
      hit.addEventListener('mousemove', move); hit.addEventListener('touchstart', move, { passive: true }); hit.addEventListener('touchmove', move, { passive: true });
      hit.addEventListener('mouseleave', leave); hit.addEventListener('touchend', () => setTimeout(leave, 1500));
    };
    if (!el.id) el.id = 'c' + Math.random().toString(36).slice(2, 8);
    draw();
    onResize(el, draw);
  }

  /** Virtulis. items: [{ label, value, color }] */
  function donut(el, { items, size = 170, thickness = 22, center = '', sub = '' }) {
    const total = items.reduce((s, i) => s + i.value, 0) || 1;
    const r = (size - thickness) / 2, C = 2 * Math.PI * r;
    let off = 0;
    let svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Sadalījums"><g transform="rotate(-90 ${size / 2} ${size / 2})">`;
    svg += `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(46,58,47,.07)" stroke-width="${thickness}"/>`;
    const gap = items.length > 1 ? 3 : 0;
    items.forEach((it, i) => {
      const len = (it.value / total) * C;
      svg += `<circle class="seg" data-i="${i}" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${it.color}" stroke-width="${thickness}" stroke-linecap="round"
        stroke-dasharray="${Math.max(0.01, len - gap)} ${C}" stroke-dashoffset="${-off}" style="transition:stroke-width .2s;cursor:pointer"/>`;
      off += len;
    });
    svg += `</g><text x="50%" y="48%" text-anchor="middle" font-size="26" font-weight="800" fill="#2E3A2F" letter-spacing="-.5">${esc(center)}</text>
      <text x="50%" y="62%" text-anchor="middle" font-size="11.5" fill="#8a8e82">${esc(sub)}</text></svg>`;
    el.innerHTML = svg;
    el.querySelectorAll('.seg').forEach(s => {
      s.addEventListener('mouseenter', () => s.setAttribute('stroke-width', thickness + 6));
      s.addEventListener('mouseleave', () => s.setAttribute('stroke-width', thickness));
    });
  }

  /** Vertikāli stabiņi. */
  function bars(el, { labels, values, height = 200, color = '#6B7F5B', highlight = '#C96F4F', format = v => v }) {
    const draw = () => {
      const W = Math.max(240, el.clientWidth), H = height, pad = { t: 22, b: 26 };
      const n = values.length, max = Math.max(1, ...values);
      const slot = W / n, bw = Math.min(38, slot * 0.56);
      const top = values.indexOf(Math.max(...values));
      let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Stabiņu grafiks"><defs>
        <linearGradient id="bg${el.id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity=".55"/></linearGradient>
        <linearGradient id="bh${el.id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${highlight}"/><stop offset="1" stop-color="${highlight}" stop-opacity=".6"/></linearGradient></defs>`;
      values.forEach((v, i) => {
        const ih = H - pad.t - pad.b, h = Math.max(4, (v / max) * ih);
        const xx = i * slot + (slot - bw) / 2, yy = pad.t + ih - h;
        svg += `<rect x="${xx}" y="${pad.t}" width="${bw}" height="${ih}" rx="${Math.min(12, bw / 2)}" fill="rgba(46,58,47,.05)"/>`;
        svg += `<rect class="bar" x="${xx}" y="${yy}" width="${bw}" height="${h}" rx="${Math.min(12, bw / 2)}" fill="url(#${i === top && v > 0 ? 'bh' : 'bg'}${el.id})" style="transform-origin:${xx + bw / 2}px ${pad.t + ih}px"/>`;
        svg += `<text x="${xx + bw / 2}" y="${yy - 7}" text-anchor="middle" font-size="11" font-weight="700" fill="#2E3A2F">${v ? esc(format(v)) : ''}</text>`;
        svg += `<text x="${xx + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="11.5" fill="#8a8e82">${esc(labels[i])}</text>`;
      });
      el.innerHTML = svg + '</svg>';
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.querySelectorAll('.bar').forEach((b, i) => b.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 700, delay: i * 50, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }));
      }
    };
    if (!el.id) el.id = 'c' + Math.random().toString(36).slice(2, 8);
    draw();
    onResize(el, draw);
  }

  /** Mazs sparkline */
  function spark(values, { w = 110, h = 34, color = '#C96F4F' } = {}) {
    const max = Math.max(1, ...values), n = values.length;
    const pts = values.map((v, i) => [(i / Math.max(1, n - 1)) * w, h - 3 - (v / max) * (h - 6)]);
    const d = smoothPath(pts, h);
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/></svg>`;
  }

  return { area, donut, bars, spark };
})();
