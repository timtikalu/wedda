// Detailblätter für die Kacheln (wie Apple Wetter): Tagesauswahl, 24-h-Diagramm zum Nachfahren, Tagesübersicht, Erklärung.
import { glyph } from './icons.js';
import { uvLabel, aqiLabel, compass, moonPhase, mean, parseLocal, describe } from './essence.js';
import { SOURCES } from './data.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = (tz, o) => new Intl.DateTimeFormat('de-DE', { timeZone: tz, ...o });
const hnum = (tz, t) => String(parseInt(fmt(tz, { hour: 'numeric', hourCycle: 'h23' }).format(t), 10));
const hhmm = (tz, t) => fmt(tz, { hour: '2-digit', minute: '2-digit' }).format(t);
const r = v => (v == null || Number.isNaN(v) ? '–' : Math.round(v));
const n1 = v => (v == null ? '–' : v.toLocaleString('de-DE', { maximumFractionDigits: 1 }));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vals = (hs, k) => hs.map(k).filter(v => v != null && !Number.isNaN(v));
const maxBy = (hs, k) => hs.reduce((a, h) => (k(h) != null && (a == null || k(h) > k(a)) ? h : a), null);

// ---------- Kennzahlen ----------
const METRICS = {
  models: {
    title: 'Modell-Einigkeit', icon: 'models', unit: '°',
    series: [0, 1, 2, 3].map(i => ({ key: h => h.temps?.[i], color: ['#64d2ff', '#ffd60a', '#ff9f0a', '#ff6482'][i], label: SOURCES[i].name })),
    head: (c) => c.today ? { big: `${r(c.f.current.temp)}°`, sub: 'Ø aktuell' } : { big: `${r(c.day.hi)}° / ${r(c.day.lo)}°`, sub: 'Ø Höchst- / Tiefstwert' },
    summary: c => {
      const parts = SOURCES.map((m, i) => c.day.his[i] == null ? null : `${m.name} ${r(c.day.his[i])}° / ${r(c.day.los[i])}°`).filter(Boolean);
      const sp = c.day.spread;
      return `${parts.join(' · ')}. Spanne der Höchstwerte ${n1(sp)}° – ${sp <= 1.5 ? 'die Quellen sind sich einig.' : sp <= 3 ? 'leichte Abweichungen.' : 'deutliche Unsicherheit.'}`;
    },
    info: 'Die Kurven zeigen die stündliche Temperatur jeder Quelle: DWD ICON (blau), NOAA GFS (gelb), ECMWF IFS (orange) und DWD MOSMIX (rosa) – eine vom DWD statistisch auf den nächsten Vorhersagepunkt korrigierte Vorhersage. Je enger die Kurven beieinander liegen, desto verlässlicher ist die Vorhersage. Angezeigt wird in der App der Mittelwert.',
  },
  uv: {
    title: 'UV-Index', icon: 'sun', unit: '', yMin: 0, yMaxMin: 8,
    series: [{ key: h => h.uv, color: '#ffd60a', grad: ['#bf5af2', '#ff453a', '#ff9f0a', '#ffd60a', '#34c759'], area: true }],
    head: c => {
      const v = c.today ? (c.f.current.isDay ? c.f.current.uv ?? 0 : 0) : Math.max(0, ...vals(c.hs, h => h.uv));
      return { big: `${r(v)}`, sub: `${uvLabel(v)}${c.today ? '' : ' (Maximum)'}` };
    },
    summary: c => {
      const top = maxBy(c.hs, h => h.uv);
      if (!top || (top.uv ?? 0) < 1) return 'Der UV-Index bleibt den ganzen Tag niedrig.';
      const high = c.hs.filter(h => (h.uv ?? 0) >= 3);
      return `Höchstwert ${r(top.uv)} (${uvLabel(top.uv)}) gegen ${hnum(c.tz, top.t)} Uhr.${high.length ? ` UV-Schutz empfohlen von ${hnum(c.tz, high[0].t)} bis ${hnum(c.tz, high.at(-1).t + 3600e3)} Uhr.` : ''}`;
    },
    info: 'Der UV-Index der WHO gibt die Stärke der sonnenbrandwirksamen Strahlung an. Ab 3 ist Sonnenschutz sinnvoll, ab 8 sollte man die Mittagssonne meiden. Quelle: NOAA GFS (die anderen Modelle liefern keinen UV-Index).',
  },
  wind: {
    title: 'Wind', icon: 'wind', unit: 'km/h', yMin: 0, yMaxMin: 20,
    series: [
      { key: h => h.gust, color: '#34c759', area: true, faint: true, label: 'Böen' },
      { key: h => h.wind, color: '#30d5c8', area: true, label: 'Wind' },
    ],
    arrows: true,
    head: c => c.today
      ? { big: `${r(c.f.current.wind)} km/h`, sub: `Böen ${r(c.f.current.gust)} km/h · aus ${compass(c.f.current.dir)}` }
      : { big: `${r(Math.min(...vals(c.hs, h => h.wind)))}–${r(Math.max(...vals(c.hs, h => h.gust ?? h.wind)))} km/h`, sub: 'Wind bis Böen' },
    summary: c => {
      const w = maxBy(c.hs, h => h.wind), g = maxBy(c.hs, h => h.gust);
      return `Stärkster Wind ${r(w?.wind)} km/h gegen ${hnum(c.tz, w.t)} Uhr, Böen bis ${r(g?.gust)} km/h. Vorherrschend aus ${compass(c.day.dir)}.`;
    },
    info: 'Wind ist das Mittel über 10 Minuten in 10 m Höhe, Böen sind kurze Spitzen. Die Pfeile zeigen, wohin der Wind weht. Werte: Mittel aus ICON, GFS, IFS und MOSMIX.',
  },
  precip: {
    title: 'Niederschlag', icon: 'drop', unit: 'mm', yMin: 0, yMaxMin: 2, bars: true,
    series: [{ key: h => h.precip, color: '#5ac8fa' }],
    popLine: true,
    head: c => ({ big: `${n1(c.hs.reduce((s, h) => s + (h.precip || 0), 0))} mm`, sub: c.today ? 'heute gesamt' : 'Tagessumme' }),
    summary: c => {
      const sum = c.hs.reduce((s, h) => s + (h.precip || 0), 0);
      const p = maxBy(c.hs, h => h.pop);
      if (sum < 0.1) return `Kein nennenswerter Niederschlag erwartet${p?.pop ? ` (Wahrscheinlichkeit max. ${r(p.pop)} %)` : ''}.`;
      const wet = c.hs.filter(h => (h.precip ?? 0) >= 0.1);
      return `${n1(sum)} mm, vor allem zwischen ${hnum(c.tz, wet[0].t)} und ${hnum(c.tz, wet.at(-1).t + 3600e3)} Uhr. Höchste Wahrscheinlichkeit ${r(p?.pop)} % gegen ${hnum(c.tz, p.t)} Uhr.`;
    },
    info: 'Balken: stündliche Niederschlagsmenge (Mittel aus ICON, GFS, IFS und MOSMIX). Linie: Regenwahrscheinlichkeit. 1 mm entspricht 1 Liter pro Quadratmeter.',
  },
  feels: {
    title: 'Gefühlt', icon: 'thermo', unit: '°',
    series: [
      { key: h => h.temp, color: 'rgba(255,255,255,.55)', dashed: true, label: 'Tatsächlich' },
      { key: h => h.feels, color: '#ff9f0a', label: 'Gefühlt' },
    ],
    head: c => c.today ? { big: `${r(c.f.current.feels)}°`, sub: `Tatsächlich ${r(c.f.current.temp)}°` }
      : { big: `${r(Math.min(...vals(c.hs, h => h.feels)))}°–${r(Math.max(...vals(c.hs, h => h.feels)))}°`, sub: 'Spanne' },
    summary: c => {
      const diff = mean(c.hs.map(h => (h.feels ?? h.temp) - h.temp));
      return `Gefühlt zwischen ${r(Math.min(...vals(c.hs, h => h.feels)))}° und ${r(Math.max(...vals(c.hs, h => h.feels)))}°. ${diff <= -2 ? 'Wind lässt es spürbar kühler wirken.' : diff >= 2 ? 'Feuchte Luft lässt es wärmer wirken.' : 'Kaum Unterschied zur gemessenen Temperatur.'}`;
    },
    info: 'Die gefühlte Temperatur berücksichtigt Wind, Luftfeuchtigkeit und Sonne. Gestrichelt: tatsächliche Temperatur.',
  },
  humidity: {
    title: 'Luftfeuchtigkeit', icon: 'humidity', unit: '%', yMin: 0, yMax: 100,
    series: [{ key: h => h.rh, color: '#64d2ff', area: true }],
    head: c => c.today ? { big: `${r(c.f.current.rh)} %`, sub: `Taupunkt ${r(c.f.current.dew)}°` } : { big: `${r(mean(c.hs.map(h => h.rh)))} %`, sub: 'Durchschnitt' },
    summary: c => `Durchschnittlich ${r(mean(c.hs.map(h => h.rh)))} %, Taupunkt zwischen ${r(Math.min(...vals(c.hs, h => h.dew)))}° und ${r(Math.max(...vals(c.hs, h => h.dew)))}°.`,
    info: 'Relative Luftfeuchtigkeit: wie viel Wasserdampf die Luft im Verhältnis zum Maximum enthält. Aussagekräftiger für das Empfinden ist der Taupunkt – ab etwa 16° wirkt die Luft schwül.',
  },
  visibility: {
    title: 'Sichtweite', icon: 'eye', unit: 'km', yMin: 0, yMaxMin: 10,
    series: [{ key: h => (h.vis == null ? null : h.vis / 1000), color: '#a2c4e8', area: true }],
    head: c => c.today ? { big: `${r((c.f.current.vis ?? 0) / 1000)} km`, sub: 'aktuell' } : { big: `${r(Math.min(...vals(c.hs, h => h.vis)) / 1000)} km`, sub: 'Minimum' },
    summary: c => {
      const v = vals(c.hs, h => h.vis);
      if (!v.length) return 'Für diesen Tag liefern die Modelle keine Sichtweite.';
      const min = Math.min(...v) / 1000;
      return `Zwischen ${n1(min)} und ${r(Math.max(...v) / 1000)} km. ${min < 1 ? 'Zeitweise Nebel möglich.' : min < 5 ? 'Zeitweise eingeschränkte Sicht.' : 'Gute Sicht.'}`;
    },
    info: 'Wie weit man horizontal klar sehen kann. Nebel, Dunst und Niederschlag verringern die Sichtweite. Quelle: Mittel aus ICON, GFS und MOSMIX.',
  },
  pressure: {
    title: 'Luftdruck', icon: 'gauge', unit: 'hPa',
    series: [{ key: h => h.pres, color: '#c7c7cc', area: true }],
    head: c => c.today ? { big: `${r(c.f.current.pres)} hPa`, sub: 'aktuell (auf Meereshöhe)' } : { big: `${r(mean(c.hs.map(h => h.pres)))} hPa`, sub: 'Durchschnitt' },
    summary: c => {
      const a = c.hs[0]?.pres, b = c.hs.at(-1)?.pres;
      if (a == null || b == null) return '';
      const d = b - a;
      return `Von ${r(a)} auf ${r(b)} hPa – ${Math.abs(d) < 2 ? 'weitgehend gleichbleibend' : d > 0 ? 'steigend, meist Wetterberuhigung' : 'fallend, oft Wetterverschlechterung'}.`;
    },
    info: 'Luftdruck auf Meereshöhe umgerechnet. Schnell fallender Druck kündigt oft Regen oder Wind an, steigender Druck ruhigeres Wetter.',
  },
  aqi: {
    title: 'Luftqualität', icon: 'leaf', unit: '', yMin: 0, yMaxMin: 60,
    series: [{ key: h => h.aqi, color: '#50ccaa', area: true }],
    head: c => {
      const v = c.today ? c.d.air?.current?.european_aqi : Math.max(...vals(c.hs, h => h.aqi));
      return { big: `${r(v)}`, sub: `${aqiLabel(v)}${c.today ? '' : ' (Maximum)'}` };
    },
    summary: c => {
      const v = vals(c.hs, h => h.aqi);
      if (!v.length) return 'Für diesen Tag gibt es keine Luftqualitätsvorhersage.';
      return `Zwischen ${r(Math.min(...v))} und ${r(Math.max(...v))} – überwiegend „${aqiLabel(mean(v))}".`;
    },
    info: 'Europäischer Luftqualitätsindex (0–20 sehr gut, bis 40 gut, bis 60 mäßig, darüber schlecht). Berücksichtigt Feinstaub, Ozon, Stickstoffdioxid und Schwefeldioxid. Quelle: CAMS über Open-Meteo.',
  },
  sun: { title: 'Sonne', icon: 'sunrise', special: 'sun' },
  moon: { title: 'Mond', icon: 'moon', special: 'moon' },
};
export const TILE_KIND = { models: 'models', sun: 'uv', sunrise: 'sun', sunset: 'sun', wind: 'wind', drop: 'precip', thermo: 'feels', humidity: 'humidity', eye: 'visibility', gauge: 'pressure', leaf: 'aqi', moon: 'moon' };

// ---------- Blatt ----------
let el, state;

function ensure() {
  if (el) return;
  el = document.createElement('div');
  el.className = 'sheet-wrap';
  el.innerHTML = `<div class="sheet-backdrop"></div>
    <section class="sheet" role="dialog" aria-modal="true">
      <header class="sheet-head"><h3></h3><button class="round-btn sheet-close" type="button" aria-label="Schließen">${glyph('close', 15)}</button></header>
      <div class="sheet-days"></div>
      <div class="sheet-body"></div>
    </section>`;
  document.body.appendChild(el);
  el.querySelector('.sheet-backdrop').addEventListener('click', close);
  el.querySelector('.sheet-close').addEventListener('click', close);
  el.querySelector('.sheet-days').addEventListener('click', e => {
    const b = e.target.closest('[data-i]');
    if (b) { state.idx = +b.dataset.i; render(); }
  });
  document.addEventListener('keydown', e => {
    if (!el.classList.contains('open')) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight' && state.idx < state.f.daily.length - 1) { state.idx++; render(); }
    if (e.key === 'ArrowLeft' && state.idx > 0) { state.idx--; render(); }
  });
  // Nach unten wischen schließt (wie ein iOS-Sheet)
  let y0 = null;
  const sheet = el.querySelector('.sheet');
  sheet.addEventListener('touchstart', e => { y0 = sheet.scrollTop <= 0 && !e.target.closest('.chart') ? e.touches[0].clientY : null; }, { passive: true });
  sheet.addEventListener('touchmove', e => {
    if (y0 == null) return;
    const dy = e.touches[0].clientY - y0;
    if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  sheet.addEventListener('touchend', e => {
    if (y0 == null) return;
    const dy = e.changedTouches[0].clientY - y0;
    sheet.style.transform = '';
    y0 = null;
    if (dy > 110) close();
  });
  addEventListener('resize', () => { if (el.classList.contains('open')) render(); });
}

export function openSheet(kind, f, d) {
  if (!METRICS[kind]) return;
  ensure();
  state = { kind, f, d, idx: 0 };
  render();
  el.classList.add('open');
  document.body.classList.add('modal-open');
  el.querySelector('.sheet').scrollTop = 0;
}
export function updateSheet(f, d) {
  if (el?.classList.contains('open')) { state.f = f; state.d = d; render(); }
}
function close() {
  el.classList.remove('open');
  document.body.classList.remove('modal-open');
}

function aqiByTime(d) {
  const a = d.air?.hourly;
  if (!a?.time) return null;
  const m = new Map();
  a.time.forEach((t, i) => m.set(parseLocal(t, d.air.utc_offset_seconds), a.european_aqi?.[i]));
  return m;
}

function render() {
  const { kind, f, d, idx } = state;
  const M = METRICS[kind];
  const tz = f.tz;
  const day = f.daily[idx];
  const today = idx === 0;
  const aqi = kind === 'aqi' ? aqiByTime(d) : null;
  const hs = f.hours.filter(h => h.t >= day.t && h.t < day.t + 864e5).map(h => (aqi ? { ...h, aqi: aqi.get(h.t) } : h));
  const c = { f, d, day, hs, tz, today };

  el.querySelector('.sheet-head h3').innerHTML = `${glyph(M.icon, 17)}${M.title}`;
  el.querySelector('.sheet-days').innerHTML = f.daily.map((x, i) => {
    const t = x.t + 12 * 3600e3;
    return `<button type="button" data-i="${i}" class="${i === idx ? 'on' : ''}">
      <small>${i === 0 ? 'Heute' : fmt(tz, { weekday: 'short' }).format(t).replace('.', '')}</small>
      <b>${fmt(tz, { day: 'numeric' }).format(t)}</b></button>`;
  }).join('');
  el.querySelector('.sheet-days .on')?.scrollIntoView({ inline: 'center', block: 'nearest' });

  const body = el.querySelector('.sheet-body');
  const dateLine = fmt(tz, { weekday: 'long', day: 'numeric', month: 'long' }).format(day.t + 12 * 3600e3);
  if (M.special === 'sun') { body.innerHTML = sunBody(c, dateLine); return; }
  if (M.special === 'moon') { body.innerHTML = moonBody(c, dateLine); return; }
  if (!hs.length) { body.innerHTML = `<p class="sheet-sum">Keine Stundenwerte für diesen Tag.</p>`; return; }

  const head = M.head(c);
  body.innerHTML = `
    <div class="sheet-value"><span class="sv-big">${head.big}</span><span class="sv-sub">${esc(head.sub)}</span><span class="sv-date">${dateLine}</span></div>
    <div class="chart-card"><div class="chart"></div>${legend(M)}</div>
    <h4>Tagesübersicht</h4>
    <p class="sheet-sum">${esc(M.summary(c))}</p>
    <h4>Über ${M.title === 'Gefühlt' ? 'die gefühlte Temperatur' : M.title === 'Modell-Einigkeit' ? 'die Modell-Einigkeit' : M.title === 'Wind' ? 'den Wind' : M.title === 'Luftdruck' ? 'den Luftdruck' : M.title === 'Niederschlag' ? 'den Niederschlag' : M.title === 'UV-Index' ? 'den UV-Index' : `die ${M.title}`}</h4>
    <p class="sheet-info">${esc(M.info)}</p>`;
  drawChart(body.querySelector('.chart'), M, c, head);
}

function legend(M) {
  const items = M.series.filter(s => s.label).map(s => `<span><i style="background:${s.color}"></i>${s.label}</span>`);
  if (M.popLine) items.push('<span><i style="background:#fff"></i>Wahrscheinlichkeit</span>');
  return items.length ? `<div class="chart-legend">${items.join('')}</div>` : '';
}

// ---------- Diagramm (24 h, nachfahrbar) ----------
function drawChart(host, M, c, head) {
  const W = Math.max(260, host.clientWidth), H = 190, padL = 6, padR = 38, padT = 12, padB = 24;
  const cw = W - padL - padR, ch = H - padT - padB;
  const { hs, day, tz } = c;
  const x = t => padL + ((t - day.t) / 864e5) * cw;
  const all = M.series.flatMap(s => vals(hs, s.key));
  let lo = M.yMin ?? Math.floor(Math.min(...all) - 1);
  let hi = M.yMax ?? Math.max(M.yMaxMin ?? -Infinity, Math.ceil(Math.max(...all) * (M.yMin === 0 ? 1.15 : 1) + (M.yMin === 0 ? 0 : 1)));
  if (!all.length) { lo = 0; hi = 1; }
  if (hi - lo < 4 && M.unit === 'hPa') { lo -= 2; hi += 2; }
  const y = v => padT + ch - ((clamp(v, lo, hi) - lo) / (hi - lo || 1)) * ch;

  const ticks = niceTicks(lo, hi, 4);
  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>${M.series.map((s, i) => `<linearGradient id="cg${i}" x1="0" y1="0" x2="0" y2="1">${
      s.grad ? s.grad.map((col, k) => `<stop offset="${k / (s.grad.length - 1)}" stop-color="${col}" stop-opacity="${0.75 - k * 0.1}"/>`).join('')
        : `<stop offset="0" stop-color="${s.color}" stop-opacity="${s.faint ? 0.35 : 0.5}"/><stop offset="1" stop-color="${s.color}" stop-opacity="0.05"/>`
    }</linearGradient>`).join('')}</defs>`;
  // Tag/Nacht-Hinterlegung
  if (day.sunriseT && day.sunsetT) {
    svg += `<rect x="${padL}" y="${padT}" width="${cw}" height="${ch}" fill="rgba(0,0,0,.18)" rx="6"/>`;
    svg += `<rect x="${x(day.sunriseT)}" y="${padT}" width="${x(day.sunsetT) - x(day.sunriseT)}" height="${ch}" fill="rgba(255,255,255,.06)"/>`;
  }
  ticks.forEach(t => {
    svg += `<line x1="${padL}" x2="${padL + cw}" y1="${y(t)}" y2="${y(t)}" stroke="rgba(255,255,255,.12)" stroke-dasharray="2 4"/>
      <text x="${W - 4}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="rgba(255,255,255,.6)">${t}${M.unit === '°' ? '°' : ''}</text>`;
  });
  [0, 6, 12, 18].forEach(hh => {
    const xx = padL + (hh / 24) * cw;
    svg += `<line x1="${xx}" x2="${xx}" y1="${padT}" y2="${padT + ch}" stroke="rgba(255,255,255,.08)"/>
      <text x="${xx + 2}" y="${H - 6}" font-size="11" fill="rgba(255,255,255,.6)">${hh} Uhr</text>`;
  });

  const mid = h => x(h.t + 1800e3);
  M.series.forEach((s, i) => {
    const pts = hs.filter(h => s.key(h) != null);
    if (!pts.length) return;
    if (M.bars) {
      const bw = Math.max(3, cw / 24 - 3);
      pts.forEach(h => { const v = s.key(h); if (v > 0) svg += `<rect x="${mid(h) - bw / 2}" y="${y(v)}" width="${bw}" height="${padT + ch - y(v)}" rx="2" fill="${s.color}"/>`; });
      return;
    }
    const line = pts.map((h, k) => `${k ? 'L' : 'M'}${mid(h).toFixed(1)},${y(s.key(h)).toFixed(1)}`).join('');
    if (s.area) svg += `<path d="${line}L${mid(pts.at(-1))},${padT + ch}L${mid(pts[0])},${padT + ch}Z" fill="url(#cg${i})"/>`;
    svg += `<path d="${line}" fill="none" stroke="${s.color}" stroke-width="${s.faint ? 1.5 : 2.5}" ${s.dashed ? 'stroke-dasharray="4 4"' : ''} stroke-linecap="round" stroke-linejoin="round"/>`;
  });
  if (M.popLine) {
    const yp = p => padT + ch - (clamp(p, 0, 100) / 100) * ch;
    const pts = hs.filter(h => h.pop != null);
    if (pts.length) svg += `<path d="${pts.map((h, k) => `${k ? 'L' : 'M'}${mid(h).toFixed(1)},${yp(h.pop).toFixed(1)}`).join('')}" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.5" stroke-dasharray="3 3"/>`;
  }
  if (M.arrows) {
    hs.filter((_, k) => k % 3 === 1).forEach(h => {
      if (h.dir == null) return;
      svg += `<g transform="translate(${mid(h)} ${padT + 9}) rotate(${h.dir + 180})"><path d="M0 -5L3.5 3H-3.5Z" fill="rgba(255,255,255,.8)"/></g>`;
    });
  }
  // Jetzt-Markierung
  if (c.today) {
    const now = Date.now(), xn = x(now);
    svg += `<line x1="${xn}" x2="${xn}" y1="${padT}" y2="${padT + ch}" stroke="rgba(255,255,255,.5)" stroke-width="1"/>`;
  }
  svg += `<g class="scrub" style="display:none"><line y1="${padT}" y2="${padT + ch}" stroke="#fff" stroke-width="1.5"/>${M.series.map(() => '<circle r="4.5" fill="#fff" stroke="rgba(0,0,0,.4)" stroke-width="1.5"/>').join('')}</g></svg>`;
  host.innerHTML = svg;

  // Nachfahren mit Finger / Maus
  const svgEl = host.querySelector('svg'), g = svgEl.querySelector('.scrub');
  const big = host.closest('.sheet-body').querySelector('.sheet-value');
  const restore = big.innerHTML;
  const move = e => {
    const rect = svgEl.getBoundingClientRect();
    const px = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const hour = clamp(Math.floor(((px - padL) / cw) * 24), 0, 23);
    const h = hs.find(q => Math.floor((q.t - day.t) / 3600e3) === hour);
    if (!h) return;
    const xx = mid(h);
    g.style.display = '';
    g.querySelector('line').setAttribute('x1', xx); g.querySelector('line').setAttribute('x2', xx);
    g.querySelectorAll('circle').forEach((ci, i) => {
      const v = M.series[i].key(h);
      ci.style.display = v == null || M.bars ? 'none' : '';
      ci.setAttribute('cx', xx); ci.setAttribute('cy', y(v ?? lo));
    });
    const main = M.series.at(-1).key(h);
    const unit = M.unit === '°' ? '°' : M.unit ? ` ${M.unit}` : '';
    let extra = '';
    if (M.series.length > 1 && M.title === 'Wind') extra = `Böen ${r(h.gust)} km/h · aus ${compass(h.dir)}`;
    else if (M.title === 'Modell-Einigkeit') extra = SOURCES.map((m, i) => h.temps?.[i] == null ? null : `${m.name} ${r(h.temps[i])}°`).filter(Boolean).join(' · ');
    else if (M.title === 'Gefühlt') extra = `Tatsächlich ${r(h.temp)}°`;
    else if (M.popLine) extra = `Wahrscheinlichkeit ${r(h.pop)} %`;
    else if (M.title === 'UV-Index') extra = uvLabel(h.uv);
    else if (M.title === 'Luftqualität') extra = aqiLabel(h.aqi);
    big.innerHTML = `<span class="sv-big">${M.title === 'Modell-Einigkeit' ? `Ø ${r(h.temp)}°` : M.bars ? `${n1(main)} mm` : `${M.unit === 'km' ? n1(main) : r(main)}${unit}`}</span>
      <span class="sv-sub">${esc(extra || describe(h.code, h.isDay))}</span><span class="sv-date">${hnum(tz, h.t)} Uhr</span>`;
  };
  const end = () => { g.style.display = 'none'; big.innerHTML = restore; };
  svgEl.addEventListener('pointermove', move);
  svgEl.addEventListener('pointerdown', move);
  svgEl.addEventListener('pointerleave', end);
  svgEl.addEventListener('touchmove', e => { e.preventDefault(); move(e); }, { passive: false });
  svgEl.addEventListener('touchend', end);
}

function niceTicks(lo, hi, n) {
  const span = hi - lo || 1;
  const step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || mag * 10;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

// ---------- Sonne & Mond ----------
function sunBody(c, dateLine) {
  const { day, tz, f } = c;
  const prev = f.daily[f.daily.indexOf(day) - 1] || f.yesterday;
  const len = day.sunriseT && day.sunsetT ? (day.sunsetT - day.sunriseT) / 60e3 : null;
  const prevLen = prev?.sunriseT && prev?.sunsetT ? (prev.sunsetT - prev.sunriseT) / 60e3 : null;
  const dl = len != null && prevLen != null ? Math.round(len - prevLen) : null;
  const W = 320, H = 130, base = 86;
  const x = t => ((t - day.t) / 864e5) * W;
  let path = '';
  for (let i = 0; i <= 96; i++) {
    const t = day.t + (i / 96) * 864e5;
    const noon = (day.sunriseT + day.sunsetT) / 2, half = (day.sunsetT - day.sunriseT) / 2;
    const yv = base - Math.cos(((t - noon) / 864e5) * 2 * Math.PI) * 60 + Math.cos((half / 864e5) * 2 * Math.PI) * 60;
    path += `${i ? 'L' : 'M'}${x(t).toFixed(1)},${clamp(yv, 6, H - 6).toFixed(1)}`;
  }
  const now = Date.now(), noon = (day.sunriseT + day.sunsetT) / 2, half = (day.sunsetT - day.sunriseT) / 2;
  const yn = base - Math.cos(((now - noon) / 864e5) * 2 * Math.PI) * 60 + Math.cos((half / 864e5) * 2 * Math.PI) * 60;
  return `<div class="sheet-value"><span class="sv-big">${hhmm(tz, day.sunsetT)}</span><span class="sv-sub">Sonnenuntergang</span><span class="sv-date">${dateLine}</span></div>
    <div class="chart-card"><svg viewBox="0 0 ${W} ${H}" class="sun-chart">
      <defs><clipPath id="above"><rect x="0" y="0" width="${W}" height="${base}"/></clipPath></defs>
      <path d="${path}" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2"/>
      <path d="${path}" fill="none" stroke="#ffd60a" stroke-width="2.5" clip-path="url(#above)"/>
      <line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="rgba(255,255,255,.4)"/>
      ${c.today ? `<circle cx="${x(now)}" cy="${clamp(yn, 6, H - 6)}" r="6" fill="#fff" ${yn <= base ? 'style="filter:drop-shadow(0 0 6px #ffd60a)"' : 'opacity=".5"'}/>` : ''}
      ${[0, 6, 12, 18].map(h => `<text x="${(h / 24) * W + 2}" y="${H - 2}" font-size="10" fill="rgba(255,255,255,.55)">${h} Uhr</text>`).join('')}
    </svg></div>
    <div class="rows">
      <div><span>Sonnenaufgang</span><b>${hhmm(tz, day.sunriseT)}</b></div>
      <div><span>Sonnenuntergang</span><b>${hhmm(tz, day.sunsetT)}</b></div>
      <div><span>Tageslänge</span><b>${len == null ? '–' : `${Math.floor(len / 60)} h ${Math.round(len % 60)} min`}</b></div>
      ${dl != null ? `<div><span>Gegenüber Vortag</span><b>${dl > 0 ? '+' : dl < 0 ? '−' : '±'}${Math.abs(dl)} min</b></div>` : ''}
    </div>
    <h4>Über die Sonne</h4>
    <p class="sheet-info">Zeiten für den ausgewählten Ort. Die helle Kurve zeigt den Sonnenstand über den Tag; über der Linie ist die Sonne sichtbar.</p>`;
}

function moonBody(c, dateLine) {
  const t = c.day.t + 12 * 3600e3;
  const m = moonPhase(t);
  const find = target => {
    for (let k = 1; k <= 31; k++) {
      const p = moonPhase(t + k * 864e5).frac, q = moonPhase(t + (k - 1) * 864e5).frac;
      if (target === 0.5 ? (q < 0.5 && p >= 0.5) : (q > p)) return t + k * 864e5;
    }
    return null;
  };
  const full = find(0.5), nu = find(0);
  const d = tt => tt ? fmt(c.tz, { weekday: 'short', day: 'numeric', month: 'short' }).format(tt).replace('.', '') : '–';
  const R = 70, k = Math.cos(2 * Math.PI * m.frac), rx = Math.abs(k) * R;
  const lit = `M0,${-R} A${R},${R} 0 0 1 0,${R} A${rx.toFixed(2)},${R} 0 0 ${k < 0 ? 1 : 0} 0,${-R}Z`;
  return `<div class="sheet-value"><span class="sv-big">${m.name}</span><span class="sv-sub">Beleuchtung ${Math.round(m.illum * 100)} %</span><span class="sv-date">${dateLine}</span></div>
    <div class="chart-card moon-card"><svg viewBox="-90 -90 180 180" class="moon-big">
      <circle r="${R}" fill="rgba(255,255,255,.1)"/>
      <path d="${lit}" fill="#f2efe4" transform="${m.frac < 0.5 ? '' : 'scale(-1 1)'}"/>
    </svg></div>
    <div class="rows">
      <div><span>Beleuchtung</span><b>${Math.round(m.illum * 100)} %</b></div>
      <div><span>Mondalter</span><b>${Math.round(m.frac * 29.53)} Tage</b></div>
      <div><span>Nächster Vollmond</span><b>${d(full)}</b></div>
      <div><span>Nächster Neumond</span><b>${d(nu)}</b></div>
    </div>
    <h4>Über den Mond</h4>
    <p class="sheet-info">Mondphase astronomisch berechnet (synodischer Monat 29,53 Tage). Mondauf- und -untergang liefern die verwendeten Quellen nicht.</p>`;
}
