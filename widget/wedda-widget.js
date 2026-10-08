// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: cloud-sun;

// wedda – Wetter-Widget (v2.3) für Scriptable
// Aktueller Standort · Höchst-/Tiefstwerte = Mittelwert aus DWD ICON, NOAA GFS, ECMWF IFS (Open-Meteo)
// Aktuelle Temperatur: DWD-Messstation (Bright Sky), wenn nah & höhengleich, sonst ICON · Warnungen: DWD
// Größen: klein, mittel, Sperrbildschirm (rechteckig, rund, Textzeile)

const APP_URL = 'https://timtikalu.github.io/wedda/';
const MODELS = ['icon_seamless', 'gfs_seamless', 'ecmwf_ifs025'];
const fm = FileManager.local();
const CACHE = fm.joinPath(fm.documentsDirectory(), 'wedda-widget-cache.json');

// ---------- Hilfen ----------
const mean = a => { const v = a.filter(x => x != null && !Number.isNaN(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const deg = v => (v == null ? '–' : `${Math.round(v)}°`);
const pick = (blk, v, i) => MODELS.map(m => blk[`${v}_${m}`]?.[i] ?? null);

function category(c) {
  if (c == null) return null;
  if (c >= 95) return 'thunder';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return c <= 57 ? 'drizzle' : 'rain';
  if (c === 45 || c === 48) return 'fog';
  if (c === 3) return 'overcast';
  if (c === 2) return 'partly';
  if (c === 1) return 'mostly';
  return 'clear';
}
const RANK = { clear: 0, mostly: 1, partly: 2, overcast: 3, fog: 3.5, drizzle: 4, rain: 5, snow: 6, thunder: 7 };
const isWet = c => ['drizzle', 'rain', 'snow', 'thunder'].includes(category(c));
const cloudCode = cc => cc == null ? 3 : cc >= 85 ? 3 : cc >= 50 ? 2 : cc >= 20 ? 1 : 0;

// Mehrheit der Modelle, sonst Median nach Wetterschwere; plausibilisiert mit gemittelter Menge
function consensus(codes, { precip = null, pop = null, cloud = null, daily = false } = {}) {
  const valid = codes.filter(c => c != null);
  if (!valid.length) return null;
  const groups = {};
  for (const c of valid) (groups[category(c)] ||= []).push(c);
  let res;
  const maj = Object.values(groups).find(g => g.length >= 2);
  if (maj) { const s = [...maj].sort((a, b) => a - b); res = s[Math.floor((s.length - 1) / 2)]; }
  else { const s = [...valid].sort((a, b) => RANK[category(a)] - RANK[category(b)]); res = s[Math.ceil((s.length - 1) / 2)]; }
  if (isWet(res) && precip != null && precip < (daily ? 0.3 : 0.1) && (pop == null || pop < 45)) {
    const dry = valid.filter(c => !isWet(c));
    res = dry.length ? dry.sort((a, b) => b - a)[0] : cloudCode(cloud);
  }
  return res;
}

const DESC = {
  0: ['Sonnig', 'Klar'], 1: ['Überwiegend sonnig', 'Überwiegend klar'], 2: 'Teilweise bewölkt', 3: 'Bewölkt',
  45: 'Nebel', 48: 'Gefrierender Nebel', 51: 'Leichter Niesel', 53: 'Nieselregen', 55: 'Starker Niesel',
  56: 'Gefr. Niesel', 57: 'Gefr. Niesel', 61: 'Leichter Regen', 63: 'Regen', 65: 'Starker Regen',
  66: 'Gefr. Regen', 67: 'Gefr. Regen', 71: 'Leichter Schnee', 73: 'Schneefall', 75: 'Starker Schnee',
  77: 'Schneegriesel', 80: 'Leichte Schauer', 81: 'Regenschauer', 82: 'Heftige Schauer',
  85: 'Schneeschauer', 86: 'Schneeschauer', 95: 'Gewitter', 96: 'Gewitter, Hagel', 99: 'Gewitter, Hagel',
};
const describe = (c, day) => { const d = DESC[c]; return !d ? '—' : Array.isArray(d) ? d[day ? 0 : 1] : d; };

function symbolName(c, day) {
  if ([56, 57, 66, 67].includes(c)) return 'cloud.sleet.fill';
  if (c === 65 || c === 82) return 'cloud.heavyrain.fill';
  switch (category(c)) {
    case 'clear': return day ? 'sun.max.fill' : 'moon.stars.fill';
    case 'mostly': case 'partly': return day ? 'cloud.sun.fill' : 'cloud.moon.fill';
    case 'overcast': return 'cloud.fill';
    case 'fog': return 'cloud.fog.fill';
    case 'drizzle': return 'cloud.drizzle.fill';
    case 'rain': return 'cloud.rain.fill';
    case 'snow': return 'cloud.snow.fill';
    case 'thunder': return 'cloud.bolt.rain.fill';
    default: return 'cloud.fill';
  }
}
function symbolColor(c, day) {
  const cat = category(c);
  if (cat === 'clear' && day) return new Color('#FFD54A');
  if (cat === 'thunder') return new Color('#FFE27A');
  return Color.white();
}

const PALETTES = {
  clear: [['#2a6fdb', '#8cc8ff'], ['#050b1d', '#1f3463']], mostly: [['#3474d4', '#9cc6f2'], ['#0a1228', '#2b3d63']],
  partly: [['#4a7cc0', '#a9c3e2'], ['#0e1528', '#313f5c']], overcast: [['#5b6b80', '#a4afbd'], ['#161b24', '#363e4c']],
  fog: [['#7c8794', '#c3c9cf'], ['#1c2027', '#40464f']], drizzle: [['#4e5d70', '#8d99a8'], ['#121820', '#2e3644']],
  rain: [['#3e4c5e', '#7b8797'], ['#0d1219', '#2a323e']], snow: [['#71839a', '#c8d2de'], ['#1a2130', '#46516a']],
  thunder: [['#2e3542', '#646c7a'], ['#08090d', '#262a33']],
};
function background(c, day) {
  const p = (PALETTES[category(c)] || PALETTES.overcast)[day ? 0 : 1];
  const g = new LinearGradient();
  g.colors = p.map(x => new Color(x));
  g.locations = [0, 1];
  return g;
}

// ---------- Daten ----------
async function getJSON(url, timeout = 15) {
  const r = new Request(url);
  r.timeoutInterval = timeout;
  return r.loadJSON();
}

async function locate(cache) {
  try {
    Location.setAccuracyToThreeKilometers();
    const l = await Location.current();
    let name = cache?.name;
    const moved = !cache || Math.hypot(l.latitude - cache.lat, l.longitude - cache.lon) > 0.02;
    if (moved || !name) {
      try {
        const g = await Location.reverseGeocode(l.latitude, l.longitude, 'de');
        name = g?.[0]?.locality || g?.[0]?.subAdministrativeArea || g?.[0]?.name || name;
      } catch { /* Name bleibt */ }
    }
    return { lat: l.latitude, lon: l.longitude, name: name || 'Mein Standort' };
  } catch {
    return cache?.lat != null ? { lat: cache.lat, lon: cache.lon, name: cache.name } : null;
  }
}

async function loadData(pos) {
  const r4 = n => Math.round(n * 1e4) / 1e4;
  const p = [
    `latitude=${r4(pos.lat)}`, `longitude=${r4(pos.lon)}`, `models=${MODELS.join(',')}`,
    'current=temperature_2m,weather_code,is_day,cloud_cover',
    'hourly=temperature_2m,precipitation,precipitation_probability,weather_code,cloud_cover',
    'daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum,precipitation_probability_max,sunrise,sunset',
    'timezone=auto', 'forecast_days=2',
  ].join('&');
  const [fc, st, al] = await Promise.allSettled([
    getJSON(`https://api.open-meteo.com/v1/forecast?${p}`),
    getJSON(`https://api.brightsky.dev/current_weather?lat=${r4(pos.lat)}&lon=${r4(pos.lon)}&max_dist=25000`, 10),
    getJSON(`https://api.brightsky.dev/alerts?lat=${r4(pos.lat)}&lon=${r4(pos.lon)}`, 10),
  ]);
  if (fc.status !== 'fulfilled' || !fc.value?.hourly) throw new Error('Keine Vorhersage');
  return { raw: fc.value, station: st.status === 'fulfilled' ? st.value : null, alerts: al.status === 'fulfilled' ? (al.value.alerts || []) : [] };
}

// DWD-Temperatur nur, wenn genau DIESES Feld von einer nahen, höhengleichen, aktuellen Station stammt
function stationTemp(st, elev) {
  const w = st?.weather;
  if (!w || w.temperature == null || Date.now() - Date.parse(w.timestamp) > 100 * 60e3) return null;
  const id = w.fallback_source_ids?.temperature ?? w.source_id;
  const src = st.sources?.find(s => s.id === id);
  if (!src || src.distance > 15000) return null;
  if (elev != null && src.height != null && Math.abs(src.height - elev) > 120) return null;
  return w.temperature;
}

function build({ raw, station, alerts }) {
  const H = raw.hourly, D = raw.daily, c = raw.current || {};
  const today = D.time[0];
  const sunrise = D.sunrise?.[0], sunset = D.sunset?.[0], sunrise2 = D.sunrise?.[1], sunset2 = D.sunset?.[1];
  const isDayAt = t => {
    const m = `${t.slice(0, 14)}15`;
    const [r, s] = t.slice(0, 10) === today ? [sunrise, sunset] : [sunrise2, sunset2];
    return r && s ? m >= r && m < s : true;
  };
  const nowKey = `${(c.time || H.time[0]).slice(0, 13)}:00`;
  let idx = H.time.indexOf(nowKey);
  if (idx < 0) idx = 0;

  const hours = [];
  for (let i = idx; i < Math.min(H.time.length, idx + 6); i++) {
    const precip = mean(pick(H, 'precipitation', i)), pop = mean(pick(H, 'precipitation_probability', i));
    hours.push({
      label: H.time[i].slice(11, 13),
      temp: mean(pick(H, 'temperature_2m', i)),
      code: consensus(pick(H, 'weather_code', i), { precip, pop, cloud: mean(pick(H, 'cloud_cover', i)) }),
      pop, day: isDayAt(H.time[i]),
    });
  }

  const precipDay = mean(pick(D, 'precipitation_sum', 0)), popDay = mean(pick(D, 'precipitation_probability_max', 0));
  let hi = mean(pick(D, 'temperature_2m_max', 0)), lo = mean(pick(D, 'temperature_2m_min', 0));
  const sTemp = stationTemp(station, raw.elevation);
  const temp = sTemp ?? c.temperature_2m ?? hours[0]?.temp;
  if (temp != null) { hi = Math.max(hi, temp); lo = Math.min(lo, temp); }
  const day = c.is_day != null ? c.is_day === 1 : hours[0]?.day ?? true;
  const code = c.weather_code ?? hours[0]?.code;
  hours[0] = { ...hours[0], label: 'Jetzt', temp, code, day };

  const now = Date.now();
  const sev = ['extreme', 'severe', 'moderate', 'minor'];
  const alert = alerts.filter(a => !a.expires || Date.parse(a.expires) > now)
    .sort((a, b) => sev.indexOf(a.severity) - sev.indexOf(b.severity))[0];
  const alertColor = alert ? new Color({ extreme: '#bf5af2', severe: '#ff453a', moderate: '#ff9f0a' }[alert.severity] || '#ffd60a') : null;
  const alertTitle = alert?.event_de
    ? alert.event_de.toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/ (Mit|Und|Von|Vor|In|Über|Bis) /g, m => m.toLowerCase())
    : null;

  return {
    temp, code, day, hi, lo, hours, precipDay, popDay,
    dayCode: consensus(pick(D, 'weather_code', 0), { precip: precipDay, pop: popDay, daily: true }),
    alertColor, alertTitle, fromStation: sTemp != null,
  };
}

// ---------- Layout ----------
function txt(stack, s, font, opacity = 1, color = Color.white()) {
  const t = stack.addText(s);
  t.font = font; t.textColor = color; t.textOpacity = opacity;
  t.lineLimit = 1; t.minimumScaleFactor = 0.6;
  return t;
}
function sym(stack, name, size, color) {
  const s = SFSymbol.named(name) || SFSymbol.named('cloud.fill');
  s.applyFont(Font.systemFont(size));
  const img = stack.addImage(s.image);
  img.imageSize = new Size(size * 1.25, size * 1.25);
  if (color) img.tintColor = color;
  return img;
}
function header(w, name, alertColor, size) {
  const row = w.addStack();
  row.centerAlignContent();
  txt(row, name, Font.semiboldSystemFont(size));
  row.addSpacer(3);
  sym(row, 'location.fill', size * 0.62, Color.white());
  if (alertColor) { row.addSpacer(4); sym(row, 'exclamationmark.triangle.fill', size * 0.75, alertColor); }
  return row;
}

function small(w, d, name) {
  w.setPadding(14, 14, 12, 14);
  header(w, name, d.alertColor, 15);
  txt(w, deg(d.temp), Font.lightSystemFont(44));
  w.addSpacer();
  sym(w, symbolName(d.code, d.day), 16, symbolColor(d.code, d.day));
  w.addSpacer(3);
  txt(w, d.alertTitle ? `⚠︎ ${d.alertTitle}` : describe(d.code, d.day), Font.semiboldSystemFont(13), 1, d.alertTitle ? d.alertColor : Color.white());
  txt(w, `H: ${deg(d.hi)} T: ${deg(d.lo)}`, Font.semiboldSystemFont(13));
}

function medium(w, d, name) {
  w.setPadding(14, 16, 12, 16);
  const top = w.addStack();
  const left = top.addStack(); left.layoutVertically();
  header(left, name, d.alertColor, 15);
  txt(left, deg(d.temp), Font.lightSystemFont(42));
  top.addSpacer();
  const right = top.addStack(); right.layoutVertically();
  const r1 = right.addStack(); r1.addSpacer(); sym(r1, symbolName(d.code, d.day), 16, symbolColor(d.code, d.day));
  right.addSpacer(3);
  const r2 = right.addStack(); r2.addSpacer();
  txt(r2, d.alertTitle ? `⚠︎ ${d.alertTitle}` : describe(d.code, d.day), Font.semiboldSystemFont(13), 1, d.alertTitle ? d.alertColor : Color.white());
  const r3 = right.addStack(); r3.addSpacer();
  txt(r3, `H: ${deg(d.hi)} T: ${deg(d.lo)}`, Font.semiboldSystemFont(13));

  w.addSpacer();
  const row = w.addStack();
  d.hours.forEach((h, i) => {
    const col = row.addStack();
    col.layoutVertically(); col.centerAlignContent();
    const a = col.addStack(); a.addSpacer(); txt(a, h.label, Font.semiboldSystemFont(12), 0.85); a.addSpacer();
    col.addSpacer(4);
    const b = col.addStack(); b.addSpacer(); sym(b, symbolName(h.code, h.day), 15, symbolColor(h.code, h.day)); b.addSpacer();
    col.addSpacer(2);
    const pop = isWet(h.code) && h.pop >= 30 ? `${Math.round(h.pop / 10) * 10}%` : ' ';
    const p = col.addStack(); p.addSpacer(); txt(p, pop, Font.boldSystemFont(9), 1, new Color('#5ac8fa')); p.addSpacer();
    const c = col.addStack(); c.addSpacer(); txt(c, deg(h.temp), Font.semiboldSystemFont(14)); c.addSpacer();
    if (i < d.hours.length - 1) row.addSpacer();
  });
}

// Sperrbildschirm: System färbt ein, daher nur Weiß + Transparenz
function accessoryRect(w, d, name) {
  const top = w.addStack(); top.centerAlignContent();
  sym(top, d.alertTitle ? 'exclamationmark.triangle.fill' : symbolName(d.code, d.day), 13);
  top.addSpacer(4);
  txt(top, name, Font.semiboldSystemFont(13));
  txt(w, `${deg(d.temp)} ${d.alertTitle || describe(d.code, d.day)}`, Font.mediumSystemFont(15));
  txt(w, `H: ${deg(d.hi)} T: ${deg(d.lo)}`, Font.systemFont(13), 0.8);
}
function accessoryCircle(w, d) {
  w.addAccessoryWidgetBackground = true;
  const a = w.addStack(); a.addSpacer(); sym(a, symbolName(d.code, d.day), 14); a.addSpacer();
  const b = w.addStack(); b.addSpacer(); txt(b, deg(d.temp), Font.semiboldSystemFont(17)); b.addSpacer();
}
function accessoryInline(w, d) {
  // Inline zeigt nur eine Textzeile
  txt(w, `${deg(d.temp)} ${d.alertTitle ? '⚠︎ ' + d.alertTitle : describe(d.code, d.day)} · H ${deg(d.hi)} T ${deg(d.lo)}`, Font.systemFont(12));
}

function errorWidget(msg) {
  const w = new ListWidget();
  w.backgroundGradient = background(3, true);
  w.url = APP_URL;
  txt(w, 'wedda', Font.semiboldSystemFont(14));
  w.addSpacer(6);
  const t = txt(w, msg, Font.systemFont(12), 0.9);
  t.lineLimit = 4;
  return w;
}

// ---------- Ablauf ----------
async function main() {
  const family = config.widgetFamily || 'medium';
  let cache = null;
  try { if (fm.fileExists(CACHE)) cache = JSON.parse(fm.readString(CACHE)); } catch { cache = null; }

  const pos = await locate(cache);
  if (!pos) return errorWidget('Standort nicht verfügbar. Öffne Scriptable einmal und erlaube den Standortzugriff („Beim Verwenden der App“ oder „Immer“).');

  let data;
  try {
    data = await loadData(pos);
    fm.writeString(CACHE, JSON.stringify({ ...pos, data, at: Date.now() }));
  } catch {
    if (cache?.data) data = cache.data;
    else return errorWidget('Keine Verbindung – Wetterdaten konnten nicht geladen werden.');
  }

  const d = build(data);
  const w = new ListWidget();
  w.url = APP_URL;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60e3);

  if (family.startsWith('accessory')) {
    if (family === 'accessoryCircular') accessoryCircle(w, d);
    else if (family === 'accessoryInline') accessoryInline(w, d);
    else accessoryRect(w, d, pos.name);
  } else {
    w.backgroundGradient = background(d.code, d.day);
    if (family === 'small') small(w, d, pos.name);
    else medium(w, d, pos.name);
  }
  return w;
}

const widget = await main();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  // Vorschau beim Start in der App
  const choice = args.queryParameters?.size || 'medium';
  if (choice === 'small') await widget.presentSmall(); else await widget.presentMedium();
}
Script.complete();
