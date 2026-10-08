// Verdichtung: drei Modelle + DWD MOSMIX → eine Vorhersage + Texte, die das Wesentliche sagen.
import { MODELS, SOURCES } from './data.js';

export const mean = arr => {
  const a = arr.filter(x => x != null && !Number.isNaN(x));
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
};
const firstVal = arr => arr.find(x => x != null) ?? null;
const circMean = arr => {
  const a = arr.filter(x => x != null);
  if (!a.length) return null;
  const s = a.reduce((acc, d) => acc + Math.sin(d * Math.PI / 180), 0);
  const c = a.reduce((acc, d) => acc + Math.cos(d * Math.PI / 180), 0);
  return (Math.atan2(s, c) * 180 / Math.PI + 360) % 360;
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Open-Meteo liefert lokale Zeitstrings ohne Offset
export const parseLocal = (s, off) =>
  Date.parse(s.length === 10 ? `${s}T00:00:00Z` : `${s}:00Z`) - off * 1000;

// ---------- Wettercodes ----------
export function category(c) {
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
export const isWet = c => ['drizzle', 'rain', 'snow', 'thunder'].includes(category(c));

const cloudCode = cc => cc == null ? 3 : cc >= 85 ? 3 : cc >= 50 ? 2 : cc >= 20 ? 1 : 0;

// Mehrheitsentscheid der Modelle; bei Uneinigkeit der Median nach „Wetterschwere".
// Danach Plausibilisierung gegen die gemittelte Niederschlagsmenge.
export function consensus(codes, { precip = null, pop = null, cloud = null, daily = false } = {}) {
  const valid = codes.filter(c => c != null);
  if (!valid.length) return null;
  const groups = {};
  for (const c of valid) (groups[category(c)] ||= []).push(c);
  let pick;
  const majority = Object.values(groups).find(g => g.length >= 2);
  if (majority) {
    const s = [...majority].sort((a, b) => a - b);
    pick = s[Math.floor((s.length - 1) / 2)];
  } else {
    const s = [...valid].sort((a, b) => RANK[category(a)] - RANK[category(b)]);
    pick = s[Math.ceil((s.length - 1) / 2)];
  }
  const dryLimit = daily ? 0.3 : 0.1;
  if (isWet(pick) && precip != null && precip < dryLimit && (pop == null || pop < 45)) {
    const dry = valid.filter(c => !isWet(c));
    pick = dry.length ? dry.sort((a, b) => b - a)[0] : cloudCode(cloud);
  }
  return pick;
}

const DESC = {
  0: ['Sonnig', 'Klar'], 1: ['Überwiegend sonnig', 'Überwiegend klar'], 2: 'Teilweise bewölkt', 3: 'Bewölkt',
  45: 'Nebel', 48: 'Gefrierender Nebel', 51: 'Leichter Nieselregen', 53: 'Nieselregen', 55: 'Starker Nieselregen',
  56: 'Gefrierender Niesel', 57: 'Gefrierender Niesel', 61: 'Leichter Regen', 63: 'Regen', 65: 'Starker Regen',
  66: 'Gefrierender Regen', 67: 'Gefrierender Regen', 71: 'Leichter Schneefall', 73: 'Schneefall',
  75: 'Starker Schneefall', 77: 'Schneegriesel', 80: 'Leichte Regenschauer', 81: 'Regenschauer',
  82: 'Heftige Schauer', 85: 'Leichte Schneeschauer', 86: 'Schneeschauer', 95: 'Gewitter',
  96: 'Gewitter mit Hagel', 99: 'Gewitter mit Hagel',
};
export function describe(code, isDay = true) {
  const d = DESC[code];
  if (!d) return '—';
  return Array.isArray(d) ? d[isDay ? 0 : 1] : d;
}

// ---------- DWD MOSMIX ----------
// Bright-Sky-Symbol → WMO-Code, damit MOSMIX beim Wettersymbol mitstimmen kann
function mosCode(w) {
  const p = w.precipitation ?? 0;
  switch (w.icon) {
    case 'thunderstorm': return 95;
    case 'hail': return 96;
    case 'snow': return p >= 1 ? 73 : 71;
    case 'sleet': return 66;
    case 'rain': return p >= 2.5 ? 65 : p >= 0.5 ? 63 : 61;
    case 'fog': return 45;
    case 'cloudy': return 3;
    case 'partly-cloudy-day': case 'partly-cloudy-night': return 2;
    case 'clear-day': case 'clear-night': return 0;
    default: return w.cloud_cover != null ? cloudCode(w.cloud_cover) : null;
  }
}
// Open-Meteo-Variable → Bright-Sky-Feld
const MOS_FIELD = {
  temperature_2m: 'temperature', precipitation: 'precipitation', precipitation_probability: 'precipitation_probability',
  wind_speed_10m: 'wind_speed', wind_gusts_10m: 'wind_gust_speed', wind_direction_10m: 'wind_direction',
  relative_humidity_2m: 'relative_humidity', dew_point_2m: 'dew_point', pressure_msl: 'pressure_msl',
  visibility: 'visibility', cloud_cover: 'cloud_cover',
};

// Nur Datensätze von Punkten ≤ 20 km und ≤ 150 m Höhenunterschied; Ergebnis: Stunde (Epoch) → Datensatz
export function mosmixSeries(mos, elev) {
  if (!mos?.weather?.length) return null;
  const ok = new Map((mos.sources || []).map(s => [s.id,
    s.distance <= 20000 && (elev == null || s.height == null || Math.abs(s.height - elev) <= 150)]));
  const fcSrc = (mos.sources || []).find(s => s.observation_type === 'forecast' && ok.get(s.id));
  if (!fcSrc) return null;
  const map = new Map();
  for (const w of mos.weather) {
    if (!ok.get(w.source_id) || w.temperature == null) continue;
    map.set(Date.parse(w.timestamp), { ...w, code: mosCode(w) });
  }
  return map.size ? { map, station: fcSrc } : null;
}

function mosDay(ms, t0) {
  const recs = [];
  for (let t = t0; t < t0 + 864e5; t += 3600e3) { const w = ms.map.get(t); if (w) recs.push(w); }
  if (recs.length < 20) return null; // Tag nicht (fast) vollständig abgedeckt
  const v = k => recs.map(w => w[k]).filter(x => x != null);
  const precip = v('precipitation').reduce((s, x) => s + x, 0);
  const codes = recs.map(w => w.code).filter(c => c != null);
  let code;
  if (codes.some(c => c >= 95)) code = 95;
  else if (precip >= 0.3 && codes.some(isWet)) {
    const cnt = {};
    codes.filter(isWet).forEach(c => { cnt[c] = (cnt[c] || 0) + 1; });
    code = +Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
  } else code = cloudCode(mean(recs.slice(8, 19).map(w => w.cloud_cover)));
  return {
    hi: Math.max(...v('temperature')), lo: Math.min(...v('temperature')), precip,
    pop: v('precipitation_probability').length ? Math.max(...v('precipitation_probability')) : null,
    windMax: v('wind_speed').length ? Math.max(...v('wind_speed')) : null,
    gustMax: v('wind_gust_speed').length ? Math.max(...v('wind_gust_speed')) : null,
    dir: circMean(v('wind_direction')), code,
  };
}

// ---------- Aufbereitung ----------
export function buildForecast(raw, station, mosRaw = null, now = Date.now()) {
  const off = raw.utc_offset_seconds;
  const tz = raw.timezone;
  const ms = mosmixSeries(mosRaw, raw.elevation);
  const pick = (blk, v, i) => MODELS.map(m => blk[`${v}_${m.id}`]?.[i] ?? null);

  // Stündlich
  const H = raw.hourly;
  const hours = H.time.map((ts, i) => {
    const t = parseLocal(ts, off);
    const mw = ms?.map.get(t);
    const p = v => [...pick(H, v, i), mw && MOS_FIELD[v] ? mw[MOS_FIELD[v]] ?? null : null];
    const temps = p('temperature_2m');
    const h = {
      t,
      temp: mean(temps), temps,
      feels: mean(p('apparent_temperature')),
      precip: mean(p('precipitation')), precips: p('precipitation'),
      pop: mean(p('precipitation_probability')),
      wind: mean(p('wind_speed_10m')), gust: mean(p('wind_gusts_10m')), dir: circMean(p('wind_direction_10m')),
      rh: mean(p('relative_humidity_2m')), dew: mean(p('dew_point_2m')), pres: mean(p('pressure_msl')),
      vis: mean(p('visibility')), uv: mean(p('uv_index')), cloud: mean(p('cloud_cover')),
      isDay: firstVal(p('is_day')) !== 0,
      votes: [...pick(H, 'weather_code', i), mw?.code ?? null],
      n: temps.filter(x => x != null).length,
    };
    h.code = consensus(h.votes, { precip: h.precip, pop: h.pop, cloud: h.cloud });
    return h;
  }).filter(h => h.temp != null);

  let nowIdx = hours.findIndex(h => now >= h.t && now < h.t + 3600e3);
  if (nowIdx < 0) nowIdx = 0;

  // Täglich
  const D = raw.daily;
  const MOS_DAY = {
    temperature_2m_max: 'hi', temperature_2m_min: 'lo', precipitation_sum: 'precip', precipitation_probability_max: 'pop',
    wind_speed_10m_max: 'windMax', wind_gusts_10m_max: 'gustMax', wind_direction_10m_dominant: 'dir', weather_code: 'code',
  };
  const days = D.time.map((ds, i) => {
    const t0 = parseLocal(ds, off);
    const md = ms ? mosDay(ms, t0) : null;
    const p = v => [...pick(D, v, i), md && MOS_DAY[v] ? md[MOS_DAY[v]] ?? null : null];
    const his = p('temperature_2m_max'), los = p('temperature_2m_min');
    const d = {
      date: ds, t: t0,
      hi: mean(his), lo: mean(los), his, los,
      precip: mean(p('precipitation_sum')), precips: p('precipitation_sum'),
      pop: mean(p('precipitation_probability_max')), pops: p('precipitation_probability_max'),
      precipHours: mean(p('precipitation_hours')),
      windMax: mean(p('wind_speed_10m_max')), gustMax: mean(p('wind_gusts_10m_max')),
      dir: circMean(p('wind_direction_10m_dominant')),
      uvMax: mean(p('uv_index_max')),
      sunrise: firstVal(p('sunrise')), sunset: firstVal(p('sunset')),
      votes: p('weather_code'),
      n: his.filter(x => x != null).length,
    };
    d.sunriseT = d.sunrise ? parseLocal(d.sunrise, off) : null;
    d.sunsetT = d.sunset ? parseLocal(d.sunset, off) : null;
    d.code = consensus(d.votes, { precip: d.precip, pop: d.pop, daily: true });
    d.spread = d.n > 1 ? Math.max(...his.filter(x => x != null)) - Math.min(...his.filter(x => x != null)) : 0;
    return d;
  }).filter(d => d.hi != null);

  // Tag/Nacht je Stunde aus Sonnenauf-/-untergang (Stundenmitte ab Viertelstunde)
  for (const h of hours) {
    const d = days.find(x => h.t >= x.t && h.t < x.t + 864e5);
    if (d?.sunriseT && d?.sunsetT) {
      const m = h.t + 15 * 60e3;
      h.isDay = m >= d.sunriseT && m < d.sunsetT;
    }
  }

  const todayStr = new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(now);
  let todayIdx = days.findIndex(d => d.date === todayStr);
  if (todayIdx < 0) todayIdx = Math.min(1, days.length - 1);
  const yesterday = todayIdx > 0 ? days[todayIdx - 1] : null;
  const daily = days.slice(todayIdx, todayIdx + 10);

  // Aktuell: DWD-Messstation (wenn nah, aktuell und höhengleich), sonst ICON-Analyse
  const c = raw.current || {};
  const nowH = hours[nowIdx] || {};
  const cur = {
    temp: c.temperature_2m ?? nowH.temp,
    feels: c.apparent_temperature ?? nowH.feels,
    rh: c.relative_humidity_2m ?? nowH.rh,
    code: c.weather_code ?? nowH.code,
    isDay: c.is_day != null ? c.is_day === 1 : nowH.isDay,
    wind: c.wind_speed_10m ?? nowH.wind,
    gust: c.wind_gusts_10m ?? nowH.gust,
    dir: c.wind_direction_10m ?? nowH.dir,
    pres: c.pressure_msl ?? nowH.pres,
    dew: nowH.dew, vis: nowH.vis, uv: nowH.uv,
    source: 'DWD ICON (Modellanalyse)',
  };
  // Jedes Messfeld einzeln prüfen: Bright Sky füllt Lücken mit Nachbarstationen auf
  const obs = stationReader(station, raw.elevation, now);
  const tSrc = obs('temperature');
  if (tSrc) {
    const w = station.weather;
    cur.temp = w.temperature;
    if (obs('relative_humidity')) cur.rh = w.relative_humidity;
    if (obs('dew_point')) cur.dew = w.dew_point;
    if (obs('pressure_msl')) cur.pres = w.pressure_msl;
    if (obs('visibility')) cur.vis = w.visibility;
    if (obs('wind_speed_10')) { cur.wind = w.wind_speed_10; if (obs('wind_direction_10')) cur.dir = w.wind_direction_10; }
    if (obs('wind_gust_speed_10')) cur.gust = w.wind_gust_speed_10;
    cur.feels = apparent(cur.temp, cur.rh, cur.wind) ?? cur.feels;
    cur.source = `DWD-Station ${tSrc.station_name} (${tSrc.distance < 1000 ? '< 1' : (tSrc.distance / 1000).toFixed(0)} km)`;
    cur.station = tSrc;
  }

  // Heute: aktuelle Temperatur liegt immer innerhalb von Hoch/Tief
  if (daily[0] && cur.temp != null) {
    daily[0].hi = Math.max(daily[0].hi, cur.temp);
    daily[0].lo = Math.min(daily[0].lo, cur.temp);
  }

  const next24 = hours.slice(nowIdx, nowIdx + 25);
  const past24 = hours.slice(Math.max(0, nowIdx - 24), nowIdx);

  return {
    tz, off, elevation: raw.elevation, now, mosmix: ms?.station || null,
    current: cur, hours, nowIdx, next24, past24, daily, yesterday,
    generated: now,
  };
}

function stationReader(st, elev, now) {
  const w = st?.weather;
  if (!w || now - Date.parse(w.timestamp) > 100 * 60e3) return () => null;
  return field => {
    if (w[field] == null) return null;
    const id = w.fallback_source_ids?.[field] ?? w.source_id;
    const src = st.sources?.find(s => s.id === id);
    if (!src || src.distance > 15000) return null;
    if (elev != null && src.height != null && Math.abs(src.height - elev) > 120) return null;
    return src;
  };
}

// Gefühlte Temperatur (Steadman, Version des australischen BoM)
function apparent(t, rh, windKmh) {
  if (t == null || rh == null || windKmh == null) return null;
  const e = rh / 100 * 6.105 * Math.exp(17.27 * t / (237.7 + t));
  return t + 0.33 * e - 0.7 * (windKmh / 3.6) - 4.0;
}

// ---------- Texte ----------
const hourFmt = tz => new Intl.DateTimeFormat('de-DE', { timeZone: tz, hour: '2-digit', hour12: false });
const fmtH = (tz, t) => hourFmt(tz).format(t); // de-DE liefert bereits „14 Uhr"
const precipNoun = code => {
  const c = category(code);
  return c === 'snow' ? 'Schnee' : c === 'thunder' ? 'Gewitter' : c === 'drizzle' ? 'Nieselregen' : 'Regen';
};

export function headline(f) {
  const { next24, tz, current, daily, yesterday } = f;
  const parts = [];
  const wetIdx = next24.findIndex((h, i) => i > 0 && isWet(h.code) && (h.pop ?? 60) >= 40);
  const wetNow = isWet(current.code) || (isWet(next24[0]?.code) && (next24[0]?.precip ?? 0) >= 0.3);

  if (wetNow) {
    const endIdx = next24.findIndex((h, i) => i > 0 && !isWet(h.code));
    const noun = precipNoun(isWet(current.code) ? current.code : next24[0].code);
    parts.push(endIdx > 0 && endIdx < 20
      ? `${noun} hört gegen ${fmtH(tz, next24[endIdx].t)} auf`
      : `${noun} hält an`);
  } else if (wetIdx > 0) {
    const h = next24[wetIdx];
    parts.push(`${precipNoun(h.code)} ab etwa ${fmtH(tz, h.t)} erwartet`);
  } else {
    parts.push(`${describe(dominantCode(next24.slice(0, 12)), current.isDay)} für die nächsten Stunden`);
  }

  const gust = Math.max(...next24.map(h => h.gust ?? 0));
  if (gust >= 50) parts.push(`Böen bis ${Math.round(gust)} km/h`);

  if (yesterday && daily[0]) {
    const diff = Math.round(daily[0].hi - yesterday.hi);
    if (Math.abs(diff) >= 3) parts.push(`${Math.abs(diff)}° ${diff > 0 ? 'wärmer' : 'kühler'} als gestern`);
  }
  return parts.join('. ') + '.';
}

function dominantCode(hs) {
  const counts = {};
  hs.forEach(h => { if (h.code != null) counts[h.code] = (counts[h.code] || 0) + 1; });
  return +Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
}

export function dailySummary(f) {
  const d = f.daily;
  if (d.length < 3) return '';
  const wetDays = d.slice(1, 7).filter(x => isWet(x.code) && (x.pop ?? 60) >= 50);
  const warmest = d.reduce((a, b) => (b.hi > a.hi ? b : a));
  const coldest = d.reduce((a, b) => (b.lo < a.lo ? b : a));
  const wdName = t => new Intl.DateTimeFormat('de-DE', { timeZone: f.tz, weekday: 'long' }).format(t);
  // Ab 7 Tagen Abstand ist der Wochentag doppelt belegt → „nächsten Donnerstag"
  const wd = t => (t - d[0].t >= 6.5 * 864e5 ? 'nächsten ' : '') + wdName(t + 12 * 3600e3);
  const parts = [];
  if (!wetDays.length) parts.push('Die kommenden Tage bleiben weitgehend trocken');
  else if (wetDays.length >= 4) parts.push('Wechselhaft mit häufigem Niederschlag');
  else parts.push(`Niederschlag vor allem am ${wetDays.slice(0, 2).map(x => wd(x.t)).join(' und ')}`);
  if (warmest !== d[0]) parts.push(`am wärmsten am ${wd(warmest.t)} mit ${Math.round(warmest.hi)}°`);
  if (coldest.lo <= 0) parts.push(`Frost möglich am ${wd(coldest.t)}`);
  const s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

// Modell-Einigkeit für heute + Tendenz über die Tage
export function agreement(f) {
  const today = f.daily[0];
  const spreadAll = mean(f.daily.slice(0, 5).map(d => d.spread));
  const level = spreadAll <= 1.5 ? 'hoch' : spreadAll <= 3 ? 'mittel' : 'gering';
  const vals = SOURCES.map((m, i) => ({ ...m, hi: today.his[i], lo: today.los[i], precip: today.precips[i] }));
  const wetVotes = today.precips.filter(p => p != null && p >= 0.5).length;
  const nValid = today.precips.filter(p => p != null).length;
  let text;
  if (level === 'hoch') text = 'Die Quellen sind sich weitgehend einig – die Vorhersage ist verlässlich.';
  else if (level === 'mittel') text = 'Leichte Abweichungen zwischen den Quellen – Details können sich noch ändern.';
  else text = 'Die Quellen weichen deutlich voneinander ab – die Vorhersage ist unsicher.';
  let rainText = '';
  if (nValid >= 2 && wetVotes > 0 && wetVotes < nValid) rainText = `Niederschlag heute: ${wetVotes} von ${nValid} Quellen.`;
  return { level, spread: spreadAll, vals, text, rainText, score: clamp(1 - spreadAll / 5, 0.05, 1) };
}

// Radar an der Position: Minutenwerte → Text für die nächste Stunde
export function nowcastText(series, tz) {
  if (!series?.length) return null;
  const now = Date.now();
  const future = series.filter(s => s.t >= now - 5 * 60e3);
  if (!future.length) return null;
  const wet = s => s.mmh >= 0.1;
  const fm = t => new Intl.DateTimeFormat('de-DE', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(t);
  const minsUntil = t => Math.max(0, Math.round((t - now) / 60e3 / 5) * 5);
  if (wet(future[0])) {
    const end = future.find(s => !wet(s));
    const heavy = Math.max(...future.map(s => s.mmh)) >= 4;
    if (end) return `${heavy ? 'Kräftiger ' : ''}Niederschlag endet in ca. ${minsUntil(end.t)} Min. (${fm(end.t)})`;
    return `${heavy ? 'Kräftiger' : 'Leichter'} Niederschlag hält vorerst an`;
  }
  const start = future.find(wet);
  if (start) return `Niederschlag ab ca. ${fm(start.t)} – in etwa ${minsUntil(start.t)} Min.`;
  return 'Kein Niederschlag in der nächsten Stunde';
}

// ---------- Kleine Helfer für die Kacheln ----------
export function uvLabel(uv) {
  if (uv == null) return '—';
  if (uv < 3) return 'Niedrig';
  if (uv < 6) return 'Mäßig';
  if (uv < 8) return 'Hoch';
  if (uv < 11) return 'Sehr hoch';
  return 'Extrem';
}
export function aqiLabel(a) {
  if (a == null) return '—';
  if (a <= 20) return 'Sehr gut';
  if (a <= 40) return 'Gut';
  if (a <= 60) return 'Mäßig';
  if (a <= 80) return 'Schlecht';
  if (a <= 100) return 'Sehr schlecht';
  return 'Extrem schlecht';
}
export function windName(kmh) {
  if (kmh == null) return '';
  const bft = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118].findIndex(v => kmh < v);
  const b = bft < 0 ? 12 : bft;
  return ['Windstill', 'Leiser Zug', 'Leichte Brise', 'Schwache Brise', 'Mäßige Brise', 'Frische Brise',
    'Starker Wind', 'Steifer Wind', 'Stürmischer Wind', 'Sturm', 'Schwerer Sturm', 'Orkanartiger Sturm', 'Orkan'][b] + ` · ${b} Bft`;
}
export function compass(deg) {
  if (deg == null) return '';
  return ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}
export function moonPhase(t) {
  const synodic = 29.530588853;
  const ref = Date.UTC(2000, 0, 6, 18, 14);
  const age = (((t - ref) / 864e5) % synodic + synodic) % synodic;
  const frac = age / synodic;
  const illum = (1 - Math.cos(2 * Math.PI * frac)) / 2;
  const names = ['Neumond', 'Zunehmende Sichel', 'Erstes Viertel', 'Zunehmender Mond', 'Vollmond',
    'Abnehmender Mond', 'Letztes Viertel', 'Abnehmende Sichel'];
  const idx = Math.round(frac * 8) % 8;
  const toFull = ((0.5 - frac + 1) % 1) * synodic;
  return { frac, illum, name: names[idx], daysToFull: Math.round(toFull) };
}
