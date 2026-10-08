// Detailansichten wie bei Apple: Niederschlag (Intensität · Wahrscheinlichkeit) und Wind (Geschwindigkeit · Böen),
// jeweils stündlich (24 h) und als Tageszeilen für 10 Tage.
import { glyph } from './icons.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = (tz, o) => new Intl.DateTimeFormat('de-DE', { timeZone: tz, ...o });
const hh = (tz, t) => fmt(tz, { hour: '2-digit' }).format(t);
const wd = (tz, t) => fmt(tz, { weekday: 'short' }).format(t + 12 * 3600e3).replace('.', '');
const r = v => (v == null ? '–' : Math.round(v));
const HOUR_W = 58;

// mm/h → Füllhöhe 0…1; gepunktete Linien bei ⅓ (mäßig) und ⅔ (stark)
export function rainLevel(mm) {
  if (mm == null || mm < 0.05) return 0;
  if (mm <= 1) return 0.06 + (mm / 1) * (1 / 3 - 0.06);
  if (mm <= 4) return 1 / 3 + ((mm - 1) / 3) * (1 / 3);
  return clamp(2 / 3 + ((mm - 4) / 6) * (1 / 3), 0, 1);
}
const popLabel = p => {
  const v = Math.round((p ?? 0) / 5) * 5;
  return v > 0 ? `<span class="pop-on">${glyph('dropFill', 11)}${v} %</span>` : `<span class="pop-off">0 %</span>`;
};
const dayHours = (f, d) => f.hours.filter(h => h.t >= d.t && h.t < d.t + 864e5);

// ---------- Kopf ----------
export const TITLES = {
  rain: ['Niederschlag', 'Intensität · Regenwahrscheinlichkeit'],
  wind: ['Wind', 'Geschwindigkeit (km/h) · Windböen'],
};

// ---------- Stündlich ----------
export function hourlyRain(f) {
  return f.next24.map((h, i) => {
    const lvl = rainLevel(h.precip);
    return `<div class="hour rain-h" title="${(h.precip ?? 0).toFixed(1)} mm">
      <span class="h-time">${i === 0 ? 'Jetzt' : hh(f.tz, h.t)}</span>
      <span class="tube"><i style="height:${(lvl * 100).toFixed(1)}%"></i></span>
      <span class="h-pop2">${popLabel(h.pop)}</span>
    </div>`;
  }).join('');
}

export function hourlyWind(f) {
  const hs = f.next24;
  const n = hs.length, W = n * HOUR_W, H = 64;
  const maxV = Math.max(20, ...hs.map(h => h.gust ?? h.wind ?? 0)) * 1.15;
  const x = i => i * HOUR_W + HOUR_W / 2;
  const y = v => H - (clamp(v ?? 0, 0, maxV) / maxV) * (H - 6) - 2;
  const path = key => hs.map((h, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(key === 'wind' && i === 0 ? f.current.wind : h[key]).toFixed(1)}`).join('');
  const edge = (d, key) => `M0,${y(hs[0][key])}L${d.slice(1)}L${W},${y(hs.at(-1)[key])}`;
  const gust = edge(path('gust'), 'gust');
  const wind = edge(path('wind'), 'wind');
  const items = hs.map((h, i) => `<div class="hour wind-h">
      <span class="h-time">${i === 0 ? 'Jetzt' : hh(f.tz, h.t)}</span>
      <span class="w-val">${r(i === 0 ? f.current.wind : h.wind)}<small>km/h</small></span>
      <span class="w-dir" style="transform:rotate(${(h.dir ?? 0) + 180}deg)">${glyph('arrowUp', 12)}</span>
    </div>`).join('');
  return `<div class="wind-track" style="width:${W}px">
    <div class="wind-items">${items}</div>
    <svg class="wind-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="gGust" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34c759" stop-opacity=".55"/><stop offset="1" stop-color="#34c759" stop-opacity=".12"/></linearGradient>
        <linearGradient id="gWind" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#30d5c8" stop-opacity=".45"/><stop offset="1" stop-color="#30d5c8" stop-opacity=".08"/></linearGradient>
      </defs>
      <path d="${gust}L${W},${H}L0,${H}Z" fill="url(#gGust)"/>
      <path d="${wind}L${W},${H}L0,${H}Z" fill="url(#gWind)"/>
      <path d="${wind}" fill="none" stroke="#30d5c8" stroke-width="3" stroke-linecap="round"/>
      <circle cx="${x(0)}" cy="${y(f.current.wind)}" r="5" fill="#fff" stroke="#1c2433" stroke-width="2.5"/>
    </svg>
  </div>`;
}

// ---------- Täglich ----------
export function dailyRain(f) {
  const now = Date.now();
  return f.daily.map((d, i) => {
    const hrs = dayHours(f, d);
    const bars = Array.from({ length: 12 }, (_, b) => {
      const blk = hrs.filter(h => h.t >= d.t + b * 2 * 3600e3 && h.t < d.t + (b + 1) * 2 * 3600e3);
      const mm = blk.length ? Math.max(...blk.map(h => h.precip ?? 0)) : 0;
      const mid = d.t + (b * 2 + 1) * 3600e3;
      const night = d.sunriseT && d.sunsetT ? (mid < d.sunriseT || mid > d.sunsetT) : (b < 3 || b > 9);
      const cur = i === 0 && now >= d.t + b * 2 * 3600e3 && now < d.t + (b + 1) * 2 * 3600e3;
      return `<i class="${night ? 'n' : ''}${cur ? ' cur' : ''}"><b style="height:${(rainLevel(mm) * 100).toFixed(0)}%"></b></i>`;
    }).join('');
    const mm = d.precip ?? 0;
    return `<div class="day"><div class="day-row rain-row">
      <span class="d-name">${i === 0 ? 'Heute' : wd(f.tz, d.t)}</span>
      <span class="mini-bars">${bars}</span>
      <span class="d-mm">${mm > 0 && mm < 0.5 ? '< 1' : Math.round(mm)} mm</span>
      <span class="d-pop2">${popLabel(d.pop)}</span>
    </div></div>`;
  }).join('');
}

export function dailyWind(f) {
  const now = Date.now();
  const all = f.daily.map(d => dayHours(f, d));
  const maxV = Math.max(20, ...all.flat().map(h => h.gust ?? 0)) * 1.1;
  const W = 120, H = 30;
  return f.daily.map((d, i) => {
    const hrs = all[i];
    if (!hrs.length) return '';
    const x = t => ((t - d.t) / 864e5) * W;
    const y = v => H - (clamp(v ?? 0, 0, maxV) / maxV) * (H - 4) - 2;
    const line = key => hrs.map((h, k) => `${k ? 'L' : 'M'}${x(h.t + 1800e3).toFixed(1)},${y(h[key]).toFixed(1)}`).join('');
    const x0 = x(hrs[0].t + 1800e3), x1 = x(hrs.at(-1).t + 1800e3);
    const dayBand = d.sunriseT && d.sunsetT ? `<rect x="${x(d.sunriseT)}" y="0" width="${x(d.sunsetT) - x(d.sunriseT)}" height="${H}" fill="rgba(255,255,255,.1)"/>` : '';
    const nowDot = i === 0 && now > d.t && now < d.t + 864e5
      ? (() => { const h = hrs.find(h => now >= h.t && now < h.t + 3600e3); return h ? `<circle cx="${x(now)}" cy="${y(f.current.wind ?? h.wind)}" r="3.5" fill="#fff"/>` : ''; })()
      : '';
    const lo = Math.min(...hrs.map(h => h.wind ?? Infinity));
    const hi = Math.max(...hrs.map(h => h.gust ?? h.wind ?? 0));
    return `<div class="day"><div class="day-row wind-row">
      <span class="d-name">${i === 0 ? 'Heute' : wd(f.tz, d.t)}</span>
      <svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <rect x="0" y="0" width="${W}" height="${H}" rx="4" fill="rgba(0,0,0,.14)"/>${dayBand}
        <path d="${line('gust')}L${x1},${H}L${x0},${H}Z" fill="rgba(52,199,89,.42)"/>
        <path d="${line('wind')}" fill="none" stroke="#30d5c8" stroke-width="2.2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
        ${nowDot}
      </svg>
      <span class="d-range">${r(lo)}–${r(hi)} km/h</span>
    </div></div>`;
  }).join('');
}

// ---------- Zusammenfassungen ----------
export function rainSummary(f) {
  const total = f.daily.slice(0, 7).reduce((s, d) => s + (d.precip ?? 0), 0);
  const wettest = f.daily.reduce((a, b) => ((b.precip ?? 0) > (a.precip ?? 0) ? b : a));
  if (total < 1) return 'In den nächsten 7 Tagen kaum Niederschlag.';
  const name = f.daily.indexOf(wettest) === 0 ? 'heute' : `am ${fmt(f.tz, { weekday: 'long' }).format(wettest.t + 12 * 3600e3)}`;
  return `Rund ${Math.round(total)} mm in den nächsten 7 Tagen, am meisten ${name} (${Math.round(wettest.precip)} mm).`;
}
export function windSummary(f) {
  const gusty = f.daily.reduce((a, b) => ((b.gustMax ?? 0) > (a.gustMax ?? 0) ? b : a));
  const name = f.daily.indexOf(gusty) === 0 ? 'heute' : `am ${fmt(f.tz, { weekday: 'long' }).format(gusty.t + 12 * 3600e3)}`;
  if ((gusty.gustMax ?? 0) < 40) return 'Die kommenden Tage bleiben eher windschwach.';
  return `Stärkste Böen ${name} mit bis zu ${r(gusty.gustMax)} km/h.`;
}
