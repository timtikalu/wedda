import { SOURCES, fetchForecast, fetchStation, fetchAlerts, fetchAir, fetchMosmix, searchPlaces, reverseGeocode } from './data.js';
import {
  buildForecast, headline, dailySummary, agreement, nowcastText, describe, category, isWet,
  uvLabel, aqiLabel, windName, compass, moonPhase, mean,
} from './essence.js';
import { weatherIcon, glyph } from './icons.js';
import { Sky, skyGradient, skyPalette } from './sky.js';
import { Radar, RADAR_LEGEND } from './radar.js';
import { WindMap, WIND_LEGEND } from './windmap.js';
import * as detail from './detail.js';
import { openSheet, updateSheet, TILE_KIND } from './sheet.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r = v => (v == null ? '–' : Math.round(v));
const deg = v => (v == null ? '–' : `${Math.round(v)}°`);
const num = (v, d = 1) => (v == null ? '–' : v.toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const STALE = 10 * 60e3;
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* Speicher voll/gesperrt */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* egal */ } },
};

let locations = store.get('wx.locations', null) || [{ id: 'geo', geo: true, name: 'Mein Standort' }];
let activeId = store.get('wx.active', locations[0].id);
if (!locations.some(l => l.id === activeId)) activeId = locations[0].id;
const data = new Map(); // id → { raw, station, alerts, air, at }
const loading = new Map();

const sky = new Sky($('#sky'), $('#sky-bg'));
const radar = new Radar($('#card-radar'));
let radarFor = null;
let radarSeries = null;
const windMap = new WindMap($('#card-wind'));
let mode = store.get('wx.mode', 'wx'); // wx | rain | wind
let lastF = null;

// ---------- Formatierung in der Zeitzone des Ortes ----------
const fmt = (tz, opts) => new Intl.DateTimeFormat('de-DE', { timeZone: tz, ...opts });
const hhmm = (tz, t) => fmt(tz, { hour: '2-digit', minute: '2-digit' }).format(t);
const hh = (tz, t) => fmt(tz, { hour: '2-digit' }).format(t); // „14 Uhr"
const hnum = (tz, t) => fmt(tz, { hour: 'numeric', hourCycle: 'h23' }).formatToParts(t).find(p => p.type === 'hour').value;
const wdShort = (tz, t) => fmt(tz, { weekday: 'short' }).format(t).replace('.', '');

// Temperatur → Farbe (für Spannenbalken)
const TSTOPS = [[-15, [94, 92, 230]], [-5, [64, 156, 255]], [3, [90, 200, 250]], [10, [102, 212, 160]], [17, [255, 214, 10]], [24, [255, 159, 10]], [31, [255, 69, 58]], [38, [191, 90, 242]]];
function tempColor(t) {
  let i = TSTOPS.findIndex(s => s[0] > t);
  if (i <= 0) return `rgb(${TSTOPS[i < 0 ? TSTOPS.length - 1 : 0][1]})`;
  const [ta, ca] = TSTOPS[i - 1], [tb, cb] = TSTOPS[i];
  const f = (t - ta) / (tb - ta);
  return `rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * f))})`;
}

// ---------- Laden ----------
function locLabel(loc) { return loc.geo ? (loc.place || 'Mein Standort') : loc.name; }

function restoreCache() {
  for (const l of locations) {
    const c = store.get(`wx.data.${l.id}`, null);
    if (c?.raw) data.set(l.id, c);
  }
}

function locate(loc) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Keine Ortung verfügbar'));
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const moved = loc.lat == null || Math.hypot(lat - loc.lat, lon - loc.lon) > 0.02;
      loc.lat = lat; loc.lon = lon;
      if (moved || !loc.place) loc.place = (await reverseGeocode(lat, lon)) || loc.place;
      saveLocations();
      resolve(moved);
    }, reject, { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60e3 });
  });
}

async function load(loc, { force = false } = {}) {
  if (loading.has(loc.id)) return loading.get(loc.id);
  const p = (async () => {
    if (loc.geo) {
      try { await locate(loc); loc.geoError = false; } catch (e) {
        loc.geoError = true;
        if (loc.lat == null) {
          renderList();
          toast('Standort nicht verfügbar – füge einen Ort über die Suche hinzu.');
          if (locations.length === 1) {
            addLocation({ name: 'Berlin', region: 'Deutschland', lat: 52.52, lon: 13.405 }, { silent: true });
          }
          return null;
        }
      }
    }
    const cached = data.get(loc.id);
    if (!force && cached && Date.now() - cached.at < STALE && cached.lat === loc.lat) return cached;
    const [fc, st, al, air, mos] = await Promise.allSettled([
      fetchForecast(loc.lat, loc.lon), fetchStation(loc.lat, loc.lon),
      fetchAlerts(loc.lat, loc.lon), fetchAir(loc.lat, loc.lon), fetchMosmix(loc.lat, loc.lon),
    ]);
    if (fc.status !== 'fulfilled') {
      if (cached) {
        toast(`Keine Verbindung – Stand ${hhmm(undefined, cached.at)} Uhr`);
        return cached;
      }
      throw fc.reason;
    }
    const entry = {
      raw: fc.value,
      station: st.status === 'fulfilled' ? st.value : null,
      alerts: al.status === 'fulfilled' ? (al.value.alerts || []) : (cached?.alerts || []),
      alertsOk: al.status === 'fulfilled' || (al.reason?.status >= 400 && al.reason?.status < 500),
      air: air.status === 'fulfilled' ? air.value : cached?.air || null,
      mos: mos.status === 'fulfilled' ? mos.value : null,
      at: Date.now(), lat: loc.lat,
    };
    data.set(loc.id, entry);
    store.set(`wx.data.${loc.id}`, entry);
    return entry;
  })();
  loading.set(loc.id, p);
  try { return await p; } finally { loading.delete(loc.id); }
}

async function show(id, { force = false } = {}) {
  activeId = id;
  store.set('wx.active', id);
  const loc = locations.find(l => l.id === id);
  if (!loc) return;
  renderDots(); renderList();
  if (data.has(id)) render(loc, data.get(id));
  else renderLoading(loc);
  try {
    const d = await load(loc, { force });
    if (d && activeId === id) render(loc, d);
    if (!d && activeId === id && !data.has(id)) $('#hero-cond').textContent = 'Standortfreigabe erforderlich';
    renderList();
    if (d && activeId === id) {
      loadRadar(loc, d);
      windMap.load(loc.lat, loc.lon, lastF?.current.wind, loc.geo ? 'Mein Standort' : locLabel(loc));
    }
  } catch (e) {
    console.error(e);
    if (activeId === id && !data.has(id)) $('#hero-cond').textContent = 'Daten konnten nicht geladen werden';
    toast('Wetterdaten konnten nicht geladen werden.');
  }
}

async function loadRadar(loc, d) {
  const key = `${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}`;
  if (radarFor === key && Date.now() - radar.loadedAt < 5 * 60e3) return;
  radarFor = key;
  const f = buildForecast(d.raw, d.station, d.mos);
  try {
    const series = await radar.load(loc.lat, loc.lon, { dark: !f.current.isDay });
    if (radarFor !== key) return;
    radar.tz = f.tz; radar.loadedAt = Date.now();
    radarSeries = series;
    $('#card-radar').hidden = false;
    radar.map?.invalidateSize();
    radar.show(radar.idx);
    renderNowcast(f.tz);
  } catch (e) {
    if (radarFor !== key) return;
    radarSeries = null;
    $('#card-radar').hidden = true;
  }
}

function refreshAll(force = false) {
  const act = locations.find(l => l.id === activeId);
  if (act) show(act.id, { force });
  for (const l of locations) if (l.id !== activeId) load(l, { force }).then(renderList).catch(() => {});
}

// ---------- Rendern ----------
function renderLoading(loc) {
  $('#hero-name').textContent = locLabel(loc);
  $('#hero-arrow').hidden = !loc.geo;
  $('#hero-sub').textContent = loc.geo ? 'Mein Standort' : '';
  $('#hero-temp').textContent = '--°';
  $('#hero-cond').textContent = 'Lade Daten …';
  $('#hero-hl').textContent = '';
  for (const s of ['#hourly', '#daily', '#tiles', '#alerts', '#hourly-title', '#daily-summary']) $(s).innerHTML = '';
}

function render(loc, d) {
  const f = buildForecast(d.raw, d.station, d.mos);
  lastF = f;
  const cur = f.current;
  const today = f.daily[0];
  $('#wind-badge').textContent = cur.wind != null ? `${Math.round(cur.wind)} km/h ${compass(cur.dir)}` : '';

  const intensity = clamp((f.next24[0]?.precip ?? 0) / 2, 0.5, 2);
  sky.set(cur.code, cur.isDay, intensity);
  document.documentElement.style.setProperty('--sky-top', skyPalette(cur.code, cur.isDay)[0]);

  const name = locLabel(loc);
  $('#hero-name').textContent = name;
  $('#hero-arrow').hidden = !loc.geo;
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  $('#hero-sub').textContent = loc.geo ? 'Mein Standort' : (f.tz !== localTz ? `${hhmm(f.tz, Date.now())} Ortszeit` : '');
  $('#hero-temp').textContent = deg(cur.temp);
  $('#hero-cond').textContent = describe(cur.code, cur.isDay);
  $('#hero-hl').textContent = today ? `H: ${deg(today.hi)}  T: ${deg(today.lo)}` : '';
  $('#compact-name').textContent = name;
  $('#compact-line').textContent = `${deg(cur.temp)} | ${describe(cur.code, cur.isDay)}`;
  document.title = `${deg(cur.temp)} ${name} – Wetter`;

  renderAlerts(d.alerts, f.tz);
  renderHourly(f);
  renderDaily(f);
  renderTiles(f, d);
  if (radarSeries && radarFor === `${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}`) renderNowcast(f.tz);

  updateSheet(f, d);
  $('#updated').textContent = `Aktualisiert ${hhmm(undefined, d.at)} Uhr · Aktuell: ${cur.source}` +
    (f.mosmix ? ` · MOSMIX: ${titleCase(f.mosmix.station_name)} (${(f.mosmix.distance / 1000).toFixed(0)} km)` : ' · MOSMIX: kein Punkt in der Nähe');
}

const SEV = {
  minor: ['#ffd60a', 'Wetterwarnung'], moderate: ['#ff9f0a', 'Markante Wetterwarnung'],
  severe: ['#ff453a', 'Unwetterwarnung'], extreme: ['#bf5af2', 'Extreme Unwetterwarnung'],
};
const SEV_ORDER = ['extreme', 'severe', 'moderate', 'minor'];
const titleCase = t => t.toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
  .replace(/ (Mit|Und|Von|Vor|In|Im|Am|Über|Bis|Oder) /g, m => m.toLowerCase());

function renderAlerts(alerts, tz) {
  const now = Date.now();
  const list = (alerts || [])
    .filter(a => !a.expires || Date.parse(a.expires) > now)
    .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
  const range = a => {
    const f = t => fmt(tz, { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(Date.parse(t)).replace('.', '');
    return a.expires ? `${f(a.onset || a.effective)} – ${f(a.expires)}` : `ab ${f(a.onset || a.effective)}`;
  };
  $('#alerts').innerHTML = list.map(a => {
    const [color, label] = SEV[a.severity] || SEV.minor;
    return `<article class="card alert" style="--sev:${color}">
      <div class="card-head">${glyph('warning')}${label} · DWD</div>
      <div class="alert-title">${esc(a.event_de ? titleCase(a.event_de) : a.headline_de)}</div>
      <div class="alert-time">${esc(range(a))}</div>
      <details><summary>Mehr anzeigen</summary>
        <div class="alert-body">${esc(a.description_de)}${a.instruction_de ? `<span class="instr">${esc(a.instruction_de)}</span>` : ''}</div>
      </details>
    </article>`;
  }).join('');
}

function renderHourly(f) {
  document.querySelectorAll('#seg button').forEach(b => {
    b.classList.toggle('on', b.dataset.mode === mode);
    b.setAttribute('aria-selected', b.dataset.mode === mode);
  });
  const el = $('#hourly');
  el.dataset.mode = mode;
  if (mode !== 'wx') {
    const [t, sub] = detail.TITLES[mode];
    $('#hourly-title').innerHTML = `<b>${t}</b><span>${sub}</span>`;
    el.innerHTML = mode === 'rain' ? detail.hourlyRain(f) : detail.hourlyWind(f);
    el.scrollLeft = 0;
    return;
  }
  $('#hourly-title').textContent = headline(f);
  const items = [];
  const start = f.next24[0]?.t, end = f.next24.at(-1)?.t;
  f.next24.forEach((h, i) => {
    const now = i === 0;
    const code = now ? f.current.code : h.code;
    const isDay = now ? f.current.isDay : h.isDay;
    const pop = isWet(code) && h.pop >= 30 ? `${Math.round(h.pop / 10) * 10} %` : '';
    items.push({ t: h.t, html: `<div class="hour">
      <span class="h-time">${now ? 'Jetzt' : hh(f.tz, h.t)}</span>
      <span class="h-icon">${weatherIcon(code, isDay, 30)}<span class="h-pop">${pop}</span></span>
      <span class="h-temp">${deg(now ? f.current.temp : h.temp)}</span></div>` });
  });
  for (const d of f.daily.slice(0, 2)) {
    for (const [t, rise] of [[d.sunriseT, true], [d.sunsetT, false]]) {
      if (t && t > start && t < end) items.push({ t, html: `<div class="hour sun">
        <span class="h-time">${hhmm(f.tz, t)}</span>
        <span class="h-icon">${sunEventIcon(rise)}<span class="h-pop"></span></span>
        <span class="h-temp">${rise ? 'Aufgang' : 'Untergang'}</span></div>` });
    }
  }
  items.sort((a, b) => a.t - b.t);
  el.innerHTML = items.map(x => x.html).join('');
  el.scrollLeft = 0;
}

function sunEventIcon(rise) {
  return `<svg class="wx" width="30" height="30" viewBox="0 0 64 64" aria-hidden="true">
    <path d="M14 44a18 18 0 0 1 36 0z" fill="url(#gSun)"/>
    <g stroke="#FFC53D" stroke-width="3.6" stroke-linecap="round"><line x1="32" y1="14" x2="32" y2="19"/><line x1="12" y1="27" x2="15.5" y2="30"/><line x1="52" y1="27" x2="48.5" y2="30"/></g>
    <line x1="8" y1="46" x2="56" y2="46" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/>
    <path d="${rise ? 'M26 57l6-6 6 6' : 'M26 51l6 6 6-6'}" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function renderDaily(f) {
  $('#card-daily .card-head').innerHTML = `${glyph('calendar')}${f.daily.length}-Tage-Vorhersage<span class="badge">Ø ${f.daily[0]?.n ?? 3} Quellen</span>`;
  if (mode !== 'wx') {
    $('#daily-summary').textContent = mode === 'rain' ? detail.rainSummary(f) : detail.windSummary(f);
    $('#daily').innerHTML = mode === 'rain' ? detail.dailyRain(f) : detail.dailyWind(f);
    return;
  }
  $('#daily-summary').textContent = dailySummary(f);
  const min = Math.min(...f.daily.map(d => d.lo)), max = Math.max(...f.daily.map(d => d.hi));
  const span = Math.max(1, max - min);
  const pct = v => ((v - min) / span) * 100;
  $('#daily').innerHTML = f.daily.map((d, i) => {
    const pop = isWet(d.code) && d.pop >= 30 ? `${Math.round(d.pop / 10) * 10} %` : '';
    const dot = i === 0 && f.current.temp != null ? `<b style="left:${pct(f.current.temp)}%"></b>` : '';
    const models = SOURCES.map((m, k) => {
      const hi = d.his[k], lo = d.los[k];
      if (hi == null) return `<div class="model missing"><b>${m.name} · ${m.org}</b>keine Daten</div>`;
      return `<div class="model"><b>${m.name} · ${m.org}</b><span class="mv">${deg(hi)} / ${deg(lo)}</span><br>${num(d.precips[k])} mm${d.pops[k] != null ? ` · ${r(d.pops[k])} %` : ''}</div>`;
    }).join('');
    const extra = [
      `Ø Niederschlag ${num(d.precip)} mm${d.pop != null ? ` · Wahrscheinlichkeit ${r(d.pop)} %` : ''}`,
      `Wind bis ${r(d.windMax)} km/h aus ${compass(d.dir)}${d.gustMax != null ? `, Böen ${r(d.gustMax)} km/h` : ''}`,
      `${d.uvMax != null ? `UV-Index ${r(d.uvMax)} · ` : ''}Spanne Höchstwert ${num(d.spread)}°${d.n < 3 ? ` · nur ${d.n} Quellen verfügbar` : ''}`,
    ].join('<br>');
    return `<div class="day">
      <button class="day-row" type="button" aria-expanded="false">
        <span class="d-name">${i === 0 ? 'Heute' : wdShort(f.tz, d.t + 12 * 3600e3)}</span>
        <span class="d-icon">${weatherIcon(d.code, true, 28)}<span class="d-pop">${pop}</span></span>
        <span class="d-lo">${deg(d.lo)}</span>
        <span class="range"><i style="left:${pct(d.lo)}%;width:${Math.max(4, pct(d.hi) - pct(d.lo))}%;background:linear-gradient(90deg,${tempColor(d.lo)},${tempColor(d.hi)})"></i>${dot}</span>
        <span class="d-hi">${deg(d.hi)}</span>
      </button>
      <div class="day-detail"><div><div class="models">${models}</div><div class="day-extra">${extra}</div></div></div>
    </div>`;
  }).join('');
}

function renderNowcast(tz) {
  const text = nowcastText(radarSeries, tz);
  $('#nowcast-text').textContent = text || '';
  const now = Date.now();
  const pts = (radarSeries || []).filter(s => s.t >= now - 5 * 60e3);
  const chart = $('#nowcast-chart');
  if (pts.length < 3 || !pts.some(p => p.mmh >= 0.1)) { chart.innerHTML = ''; return; }
  const W = 300, H = 60, t0 = pts[0].t, t1 = pts.at(-1).t;
  const x = t => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = v => H - clamp(Math.log10(1 + v) / Math.log10(1 + 10), 0, 1) * H;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.mmh).toFixed(1)}`).join('');
  const ticks = [];
  for (let m = 0; m <= (t1 - t0) / 60e3; m += 30) ticks.push(m);
  chart.innerHTML = `<svg viewBox="0 0 ${W} ${H + 16}" preserveAspectRatio="none">
    <defs><linearGradient id="ncg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5ac8fa" stop-opacity=".9"/><stop offset="1" stop-color="#5ac8fa" stop-opacity=".15"/></linearGradient></defs>
    ${[0.25, 0.5, 0.75].map(v => `<line x1="0" x2="${W}" y1="${H * v}" y2="${H * v}" stroke="rgba(255,255,255,.14)" stroke-dasharray="2 4" vector-effect="non-scaling-stroke"/>`).join('')}
    <line x1="0" x2="${W}" y1="${H}" y2="${H}" stroke="rgba(255,255,255,.3)" vector-effect="non-scaling-stroke"/>
    <path d="${line}L${W},${H}L0,${H}Z" fill="url(#ncg)"/>
    <path d="${line}" fill="none" stroke="#5ac8fa" stroke-width="2" vector-effect="non-scaling-stroke"/>
    ${ticks.map(m => `<text x="${x(t0 + m * 60e3)}" y="${H + 13}" fill="rgba(255,255,255,.6)" font-size="10" text-anchor="${m === 0 ? 'start' : 'middle'}">${m === 0 ? 'Jetzt' : `${m} Min.`}</text>`).join('')}
  </svg>`;
}

// ---------- Kacheln ----------
function tile(icon, title, body, cls = '') {
  const kind = TILE_KIND[icon];
  return `<section class="card tile ${cls}" ${kind ? `data-kind="${kind}" role="button" tabindex="0" aria-label="${title} – Details"` : ''}><div class="card-head">${glyph(icon)}${title}</div>${body}</section>`;
}
const scaleBar = (grad, p) => `<div class="scale" style="background:${grad}"><b style="left:${clamp(p, 0, 1) * 100}%"></b></div>`;

function renderTiles(f, d) {
  const cur = f.current, today = f.daily[0], tz = f.tz;
  const now = Date.now();
  const out = [];

  // Modell-Einigkeit – die „Essenz"-Kachel
  const ag = agreement(f);
  const lo = Math.min(...ag.vals.map(v => v.lo ?? Infinity)) - 1, hi = Math.max(...ag.vals.map(v => v.hi ?? -Infinity)) + 1;
  const sp = Math.max(1, hi - lo);
  out.push(tile('models', 'Modell-Einigkeit', `
    <div class="big">${ag.level[0].toUpperCase() + ag.level.slice(1)}</div>
    <div class="agree-bars">${ag.vals.map(v => v.hi == null ? '' : `<div class="agree-bar"><span>${v.name}</span>
      <span class="agree-meter"><i style="left:${((v.lo - lo) / sp) * 100}%;width:${((v.hi - v.lo) / sp) * 100}%"></i></span>
      <span>${deg(v.lo)} – ${deg(v.hi)}</span></div>`).join('')}</div>
    <p class="note">${ag.text} ${ag.rainText}</p>`, 'wide-2'));

  // UV
  const uvNow = cur.isDay ? (cur.uv ?? 0) : 0;
  const todayHours = f.hours.filter(h => h.t >= now - 3600e3 && fmt(tz, { day: 'numeric' }).format(h.t) === fmt(tz, { day: 'numeric' }).format(now));
  const uvHigh = todayHours.filter(h => (h.uv ?? 0) >= 3);
  out.push(tile('sun', 'UV-Index', `
    <div class="big">${r(uvNow)}</div><div class="label">${uvLabel(uvNow)}</div>
    ${scaleBar('linear-gradient(90deg,#34c759,#ffd60a,#ff9f0a,#ff453a,#bf5af2)', uvNow / 11)}
    <p class="note">${uvHigh.length ? `UV-Schutz von ${hnum(tz, uvHigh[0].t)}–${hnum(tz, uvHigh.at(-1).t + 3600e3)} Uhr.` : 'Niedrig für den restlichen Tag.'}</p>`));

  // Sonne
  if (today?.sunriseT && today?.sunsetT) {
    const tomorrow = f.daily[1];
    let nextT, nextRise, otherT, otherRise;
    if (now < today.sunriseT) { nextT = today.sunriseT; nextRise = true; otherT = today.sunsetT; otherRise = false; }
    else if (now < today.sunsetT) { nextT = today.sunsetT; nextRise = false; otherT = tomorrow?.sunriseT; otherRise = true; }
    else { nextT = tomorrow?.sunriseT; nextRise = true; otherT = tomorrow?.sunsetT; otherRise = false; }
    const dayLen = (today.sunsetT - today.sunriseT) / 3600e3;
    out.push(tile(nextRise ? 'sunrise' : 'sunset', nextRise ? 'Sonnenaufgang' : 'Sonnenuntergang', `
      <div class="big">${nextT ? hhmm(tz, nextT) : '–'}</div>
      ${sunArc(today.sunriseT, today.sunsetT, now)}
      <p class="note">${otherT ? `${otherRise ? 'Aufgang' : 'Untergang'}: ${hhmm(tz, otherT)}` : ''} · Tageslänge ${Math.floor(dayLen)} h ${Math.round((dayLen % 1) * 60)} min</p>`));
  }

  // Wind
  out.push(tile('wind', 'Wind', `
    <div style="display:grid;grid-template-columns:1fr 128px;gap:14px;align-items:center;flex:1">
      <div>
        <div class="row2"><span>Wind</span><b>${r(cur.wind)} km/h</b></div>
        <div class="row2"><span>Böen</span><b>${r(cur.gust)} km/h</b></div>
        <div class="row2"><span>Richtung</span><b>${r(cur.dir)}° ${compass(cur.dir)}</b></div>
        <p class="note" style="padding-top:6px">${windName(cur.wind)}</p>
      </div>
      ${compassSvg(cur.dir, cur.wind)}
    </div>`, 'wide-2'));

  // Niederschlag
  const past = f.past24.reduce((s, h) => s + (h.precip || 0), 0);
  const next = f.next24.reduce((s, h) => s + (h.precip || 0), 0);
  out.push(tile('drop', 'Niederschlag', `
    <div class="big">${num(past)} mm</div><div class="label" style="font-size:15px">in den letzten 24 h</div>
    <p class="note">${next >= 0.1 ? `${num(next)} mm in den nächsten 24 h erwartet.` : 'In den nächsten 24 h kein nennenswerter Niederschlag erwartet.'}</p>`));

  // Gefühlt
  const diff = (cur.feels ?? cur.temp) - cur.temp;
  out.push(tile('thermo', 'Gefühlt', `
    <div class="big">${deg(cur.feels)}</div>
    <p class="note">${diff <= -2 ? 'Der Wind lässt es kühler wirken.' : diff >= 2 ? 'Die Luftfeuchtigkeit lässt es wärmer wirken.' : 'Ähnlich wie die tatsächliche Temperatur.'}</p>`));

  // Luftfeuchtigkeit
  out.push(tile('humidity', 'Luftfeuchtigkeit', `
    <div class="big">${r(cur.rh)} %</div>
    <p class="note">Der Taupunkt liegt aktuell bei ${deg(cur.dew)}.</p>`));

  // Sichtweite
  const vis = cur.vis != null ? cur.vis / 1000 : null;
  out.push(tile('eye', 'Sichtweite', `
    <div class="big">${vis == null ? '–' : vis >= 10 ? r(vis) : num(vis)} km</div>
    <p class="note">${vis == null ? 'Keine Daten.' : vis >= 20 ? 'Perfekt klare Sicht.' : vis >= 10 ? 'Klare Sicht.' : vis >= 4 ? 'Leichter Dunst.' : 'Eingeschränkte Sicht durch Nebel oder Niederschlag.'}</p>`));

  // Luftdruck
  const p3 = f.hours[f.nowIdx - 3]?.pres;
  const trend = cur.pres != null && p3 != null ? cur.pres - p3 : 0;
  out.push(tile('gauge', 'Luftdruck', `
    ${gaugeSvg(cur.pres, trend)}
    <p class="note">${Math.abs(trend) < 0.8 ? 'Gleichbleibend' : trend > 0 ? 'Steigend' : 'Fallend'}${Math.abs(trend) >= 0.8 ? ` (${trend > 0 ? '+' : ''}${num(trend)} hPa in 3 h)` : ''}.</p>`));

  // Luftqualität
  const aq = d.air?.current;
  if (aq?.european_aqi != null) {
    out.push(tile('leaf', 'Luftqualität', `
      <div class="big">${r(aq.european_aqi)}</div><div class="label">${aqiLabel(aq.european_aqi)}</div>
      ${scaleBar('linear-gradient(90deg,#50f0e6,#50ccaa,#f0e641,#ff5050,#960032,#7d2181)', aq.european_aqi / 100)}
      <p class="note">Europ. Index · PM2,5 ${num(aq.pm2_5)} µg/m³</p>`));
  }

  // Mond
  const m = moonPhase(now);
  out.push(tile('moon', 'Mond', `
    <div class="label" style="margin-top:0">${m.name}</div>
    ${moonSvg(m.frac)}
    <p class="note">Beleuchtung ${Math.round(m.illum * 100)} %${m.daysToFull > 0 && m.daysToFull < 29 ? ` · Vollmond in ${m.daysToFull} Tagen` : ''}</p>`));

  $('#tiles').innerHTML = out.join('');
}

function sunArc(rise, set, now) {
  const W = 140, H = 56, base = 38;
  const dayStart = rise - (24 * 3600e3 - (set - rise)) / 2;
  const x = t => ((t - dayStart) / (24 * 3600e3)) * W;
  const y = t => base - Math.sin(((t - rise) / (set - rise)) * Math.PI) * 30;
  const pts = [];
  for (let i = 0; i <= 48; i++) {
    const t = dayStart + (i / 48) * 24 * 3600e3;
    const yy = t < rise || t > set ? base + Math.sin(Math.PI * ((t < rise ? rise - t : t - set) / (24 * 3600e3 - (set - rise)))) * 12 : y(t);
    pts.push(`${x(t).toFixed(1)},${yy.toFixed(1)}`);
  }
  const tn = clamp(now, dayStart, dayStart + 24 * 3600e3 - 1);
  const yn = tn < rise || tn > set ? base + Math.sin(Math.PI * ((tn < rise ? rise - tn : tn - set) / (24 * 3600e3 - (set - rise)))) * 12 : y(tn);
  return `<svg class="sunarc" viewBox="0 0 ${W} ${H}" style="max-width:none">
    <polyline points="${pts.join(' ')}" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="2"/>
    <line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="rgba(255,255,255,.35)"/>
    <circle cx="${x(tn)}" cy="${yn}" r="5" fill="#fff" ${yn <= base ? 'style="filter:drop-shadow(0 0 5px #fff)"' : 'opacity=".5"'}/>
  </svg>`;
}

function compassSvg(dir, speed) {
  const ticks = Array.from({ length: 72 }, (_, i) => {
    const a = i * 5 * Math.PI / 180, long = i % 6 === 0;
    const r1 = long ? 52 : 55, r2 = 59;
    return `<line x1="${64 + Math.sin(a) * r1}" y1="${64 - Math.cos(a) * r1}" x2="${64 + Math.sin(a) * r2}" y2="${64 - Math.cos(a) * r2}" stroke="rgba(255,255,255,${long ? .6 : .25})" stroke-width="${long ? 1.6 : 1}"/>`;
  }).join('');
  const lbl = [['N', 0], ['O', 90], ['S', 180], ['W', 270]].map(([t, a]) => {
    const rad = a * Math.PI / 180;
    return `<text x="${64 + Math.sin(rad) * 44}" y="${64 - Math.cos(rad) * 44 + 4}" text-anchor="middle" font-size="11" font-weight="600" fill="rgba(255,255,255,.75)">${t}</text>`;
  }).join('');
  const arrow = dir == null ? '' : `<g transform="rotate(${dir + 180} 64 64)">
      <line x1="64" y1="118" x2="64" y2="14" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
      <path d="M64 6l7 12h-14z" fill="#fff"/><circle cx="64" cy="118" r="4" fill="none" stroke="#fff" stroke-width="2.5"/></g>`;
  return `<svg class="compass" viewBox="0 0 128 128">${ticks}${lbl}${arrow}
    <circle cx="64" cy="64" r="22" fill="rgba(20,30,50,.75)"/>
    <text x="64" y="64" text-anchor="middle" font-size="18" font-weight="600" fill="#fff">${r(speed)}</text>
    <text x="64" y="77" text-anchor="middle" font-size="9.5" fill="rgba(255,255,255,.7)">km/h</text></svg>`;
}

function gaugeSvg(p, trend) {
  const min = 960, max = 1060, a0 = -135, a1 = 135;
  const ang = p == null ? null : a0 + (clamp(p, min, max) - min) / (max - min) * (a1 - a0);
  const ticks = Array.from({ length: 41 }, (_, i) => {
    const a = (a0 + i * (a1 - a0) / 40) * Math.PI / 180;
    return `<line x1="${64 + Math.sin(a) * 50}" y1="${64 - Math.cos(a) * 50}" x2="${64 + Math.sin(a) * 58}" y2="${64 - Math.cos(a) * 58}" stroke="rgba(255,255,255,.35)" stroke-width="1.2"/>`;
  }).join('');
  const needle = ang == null ? '' : `<g transform="rotate(${ang} 64 64)"><rect x="62" y="3" width="4" height="17" rx="2" fill="#fff"/></g>`;
  const arrowPath = Math.abs(trend) < 0.8 ? 'M57 47h14' : trend > 0 ? 'M64 52v-12M58 45l6-6 6 6' : 'M64 39v12M58 46l6 6 6-6';
  return `<svg class="gauge" viewBox="0 0 128 112">${ticks}${needle}
    <path d="${arrowPath}" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="64" y="76" text-anchor="middle" font-size="20" font-weight="600" fill="#fff">${p == null ? '–' : Math.round(p)}</text>
    <text x="64" y="90" text-anchor="middle" font-size="10" fill="rgba(255,255,255,.7)">hPa</text>
    <text x="28" y="110" text-anchor="middle" font-size="9" fill="rgba(255,255,255,.6)">tief</text>
    <text x="100" y="110" text-anchor="middle" font-size="9" fill="rgba(255,255,255,.6)">hoch</text></svg>`;
}

function moonSvg(frac) {
  const R = 30, waxing = frac < 0.5;
  const k = Math.cos(2 * Math.PI * frac); // 1 = neu, -1 = voll
  const rx = Math.abs(k) * R;
  const gibbous = k < 0;
  const lit = `M0,${-R} A${R},${R} 0 0 1 0,${R} A${rx.toFixed(2)},${R} 0 0 ${gibbous ? 1 : 0} 0,${-R}Z`;
  return `<svg class="moon-disc" viewBox="-40 -40 80 80" style="max-width:96px">
    <circle r="${R}" fill="rgba(255,255,255,.12)"/>
    <path d="${lit}" fill="#f2efe4" transform="${waxing ? '' : 'scale(-1 1)'}"/>
  </svg>`;
}

// ---------- Ortsliste ----------
function saveLocations() {
  store.set('wx.locations', locations.map(({ id, geo, name, region, lat, lon, place }) => ({ id, geo, name, region, lat, lon, place })));
}

function renderList() {
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  $('#loc-list').innerHTML = locations.map(l => {
    const d = data.get(l.id);
    let f = null;
    try { f = d ? buildForecast(d.raw, d.station, d.mos) : null; } catch { f = null; }
    const bg = f ? skyGradient(f.current.code, f.current.isDay) : 'linear-gradient(#2c3e57,#1b2636)';
    const warn = d?.alerts?.some(a => !a.expires || Date.parse(a.expires) > Date.now());
    const sub = l.geo ? (l.place ? 'Mein Standort' : l.geoError ? 'Ortung nicht erlaubt' : 'Wird ermittelt …') : f ? (f.tz !== localTz ? hhmm(f.tz, Date.now()) : (l.region || hhmm(f.tz, Date.now()))) : (l.region || '');
    return `<li class="loc ${l.id === activeId ? 'active' : ''}" data-id="${esc(l.id)}">
      ${l.geo ? '' : `<button class="loc-del" type="button" data-del="${esc(l.id)}">Löschen</button>`}
      <button class="loc-card" type="button" style="background:${bg}">
        <span class="lc-left"><span class="lc-name">${esc(locLabel(l))}</span><span class="lc-sub">${esc(sub)}</span></span>
        <span class="lc-temp">${f ? deg(f.current.temp) : '--°'}</span>
        <span class="lc-cond">${warn ? `<span class="loc-warn">${glyph('warning', 13)}</span>` : ''}${f ? describe(f.current.code, f.current.isDay) : ''}</span>
        <span class="lc-hl">${f?.daily[0] ? `H: ${deg(f.daily[0].hi)} T: ${deg(f.daily[0].lo)}` : ''}</span>
      </button>
    </li>`;
  }).join('');
}

function renderDots() {
  $('#dots').innerHTML = locations.map(l => l.geo
    ? `<i class="geo ${l.id === activeId ? 'on' : ''}" data-id="${esc(l.id)}">${glyph('location', 10)}</i>`
    : `<i class="${l.id === activeId ? 'on' : ''}" data-id="${esc(l.id)}"></i>`).join('');
}

function addLocation(p, { silent = false } = {}) {
  const dup = locations.find(l => !l.geo && l.lat != null && Math.hypot(l.lat - p.lat, l.lon - p.lon) < 0.02);
  if (dup) { show(dup.id); return; }
  const loc = { id: `p${Date.now().toString(36)}`, name: p.name, region: p.region, lat: p.lat, lon: p.lon };
  locations.push(loc);
  saveLocations();
  if (!silent) toast(`${p.name} hinzugefügt`);
  show(loc.id);
  for (const id of [...data.keys()]) if (!locations.some(l => l.id === id)) data.delete(id);
}

function removeLocation(id) {
  const i = locations.findIndex(l => l.id === id);
  if (i < 0 || locations[i].geo) return;
  locations.splice(i, 1);
  data.delete(id);
  store.del(`wx.data.${id}`);
  saveLocations();
  if (activeId === id) show(locations[Math.max(0, i - 1)].id);
  else { renderList(); renderDots(); }
}

function step(dir) {
  const i = locations.findIndex(l => l.id === activeId);
  const n = locations[i + dir];
  if (n) { show(n.id); $('#main').scrollTo({ top: 0 }); }
}

// ---------- Interaktion ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

function setupUI() {
  $('#list-btn').innerHTML = glyph('list', 22);
  $('#map-btn').innerHTML = glyph('radar', 22);
  $('.search-icon').innerHTML = glyph('search', 16);
  $('#hero-arrow').innerHTML = glyph('location', 18);
  $('#card-radar .card-head .ic').outerHTML = glyph('radar');
  radar.playBtn.innerHTML = glyph('play', 15);
  radar.expandBtn.innerHTML = glyph('expand', 15);
  $('#card-wind .card-head .ic').outerHTML = glyph('wind');
  $('#wind-legend').style.background = `linear-gradient(90deg,${WIND_LEGEND.join(',')})`;
  const segIcons = { wx: 'cloudsun', rain: 'dropFill', wind: 'wind' };
  document.querySelectorAll('#seg button').forEach(b => { b.innerHTML = glyph(segIcons[b.dataset.mode], 17); });
  $('#seg').addEventListener('click', e => {
    const b = e.target.closest('[data-mode]');
    if (!b || b.dataset.mode === mode) return;
    mode = b.dataset.mode;
    store.set('wx.mode', mode);
    if (lastF) { renderHourly(lastF); renderDaily(lastF); }
  });
  $('#radar-legend').style.background = `linear-gradient(90deg,${RADAR_LEGEND.join(',')})`;

  const main = $('#main');
  main.addEventListener('scroll', () => {
    const p = clamp((main.scrollTop - 70) / 110, 0, 1);
    $('#main-wrap').style.setProperty('--p', p.toFixed(3));
    main.classList.toggle('scrolled', p > 0.5);
  }, { passive: true });

  $('#list-btn').addEventListener('click', () => document.body.classList.add('show-list'));
  $('#map-btn').addEventListener('click', () => {
    if ($('#card-radar').hidden) return toast('Radar nur für Orte in Deutschland verfügbar.');
    radar.setExpanded(true);
  });

  $('#daily').addEventListener('click', e => {
    const row = e.target.closest('.day-row');
    if (!row) return;
    const day = row.parentElement;
    const open = day.classList.toggle('open');
    row.setAttribute('aria-expanded', open);
  });

  const openTile = e => {
    const t = e.target.closest('.tile[data-kind]');
    if (!t || !lastF) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openSheet(t.dataset.kind, lastF, data.get(activeId));
  };
  $('#tiles').addEventListener('click', openTile);
  $('#tiles').addEventListener('keydown', openTile);
  $('#version-line').addEventListener('click', () => window.__vpDebug?.());

  $('#dots').addEventListener('click', e => { const id = e.target.closest('[data-id]')?.dataset.id; if (id) show(id); });

  $('#loc-list').addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) return removeLocation(del.dataset.del);
    const li = e.target.closest('.loc');
    if (!li || document.body.classList.contains('editing')) return;
    document.body.classList.remove('show-list');
    show(li.dataset.id);
    $('#main').scrollTo({ top: 0 });
  });
  $('#edit-btn').addEventListener('click', () => {
    const on = document.body.classList.toggle('editing');
    $('#edit-btn').textContent = on ? 'Fertig' : 'Bearbeiten';
  });

  // Suche
  const input = $('#search'), results = $('#search-results');
  let timer, seq = 0, last = [];
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { results.hidden = true; return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      try {
        last = await searchPlaces(q);
        if (my !== seq) return;
        results.innerHTML = last.length
          ? last.map((p, i) => `<li><button type="button" data-i="${i}">${esc(p.name)}<small>${esc(p.region)}</small></button></li>`).join('')
          : '<li class="empty">Keine Treffer</li>';
        results.hidden = false;
      } catch { /* Tippfehler/Netz: still */ }
    }, 250);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && last[0]) pick(last[0]);
    if (e.key === 'Escape') { input.value = ''; results.hidden = true; document.body.classList.remove('show-list'); }
  });
  results.addEventListener('click', e => {
    const b = e.target.closest('[data-i]');
    if (b) pick(last[+b.dataset.i]);
  });
  function pick(p) {
    input.value = ''; results.hidden = true; last = [];
    document.body.classList.remove('show-list');
    addLocation(p);
    $('#main').scrollTo({ top: 0 });
  }

  // Wischen zwischen Orten (iPhone)
  let sx = 0, sy = 0, ok = false;
  main.addEventListener('touchstart', e => {
    const t = e.touches[0]; sx = t.clientX; sy = t.clientY;
    ok = !e.target.closest('.hourly, .radar, .day-detail, .wind-stage, .seg');
  }, { passive: true });
  main.addEventListener('touchend', e => {
    if (!ok) return;
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) step(dx < 0 ? 1 : -1);
  }, { passive: true });

  document.addEventListener('keydown', e => {
    if (e.target.matches('input')) return;
    if (e.key === 'ArrowRight' && e.metaKey) step(1);
    if (e.key === 'ArrowLeft' && e.metaKey) step(-1);
    if (e.key === 'r' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); refreshAll(true); toast('Aktualisiere …'); }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const d = data.get(activeId);
    if (!d || Date.now() - d.at > STALE) refreshAll();
  });
  setInterval(() => { if (!document.hidden) refreshAll(); }, STALE);

  $('#sidebar-foot').textContent = 'Daten: Open-Meteo · Bright Sky/DWD';
}

// ---------- Start ----------
setupUI();
restoreCache();
renderList();
show(activeId);
for (const l of locations) if (l.id !== activeId) load(l).then(renderList).catch(() => {});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
