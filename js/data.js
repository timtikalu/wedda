// Netzwerkschicht: Open-Meteo (3 Modelle), Bright Sky (DWD-Station, Radar, Warnungen), Luftqualität, Geocoding.

export const MODELS = [
  { id: 'icon_seamless', name: 'ICON', org: 'DWD' },
  { id: 'gfs_seamless', name: 'GFS', org: 'NOAA' },
  { id: 'ecmwf_ifs025', name: 'IFS', org: 'ECMWF' },
];

const HOURLY = [
  'temperature_2m', 'apparent_temperature', 'precipitation', 'precipitation_probability',
  'weather_code', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m',
  'relative_humidity_2m', 'dew_point_2m', 'pressure_msl', 'visibility', 'uv_index',
  'cloud_cover', 'is_day',
];
const DAILY = [
  'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum',
  'precipitation_probability_max', 'precipitation_hours', 'wind_speed_10m_max',
  'wind_gusts_10m_max', 'wind_direction_10m_dominant', 'uv_index_max', 'sunrise', 'sunset',
];
const CURRENT = [
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'weather_code', 'is_day',
  'precipitation', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'pressure_msl', 'cloud_cover',
];

async function getJSON(url, { timeout = 12000, retries = 1 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    } catch (e) {
      // 4xx (z. B. „außerhalb DWD-Gebiet") nicht wiederholen
      if (attempt >= retries || (e.status >= 400 && e.status < 500)) throw e;
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
}

const r4 = n => Math.round(n * 1e4) / 1e4;

export function fetchForecast(lat, lon) {
  const p = new URLSearchParams({
    latitude: r4(lat), longitude: r4(lon),
    models: MODELS.map(m => m.id).join(','),
    hourly: HOURLY.join(','), daily: DAILY.join(','), current: CURRENT.join(','),
    timezone: 'auto', past_days: 1, forecast_days: 10,
    wind_speed_unit: 'kmh',
  });
  return getJSON(`https://api.open-meteo.com/v1/forecast?${p}`);
}

export function fetchAir(lat, lon) {
  const p = new URLSearchParams({
    latitude: r4(lat), longitude: r4(lon),
    current: 'european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide',
    timezone: 'auto',
  });
  return getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?${p}`);
}

export function fetchStation(lat, lon) {
  return getJSON(`https://api.brightsky.dev/current_weather?lat=${r4(lat)}&lon=${r4(lon)}&max_dist=25000`);
}

export function fetchAlerts(lat, lon) {
  return getJSON(`https://api.brightsky.dev/alerts?lat=${r4(lat)}&lon=${r4(lon)}`);
}

export function fetchRadar(lat, lon, distance = 150000) {
  return getJSON(`https://api.brightsky.dev/radar?lat=${r4(lat)}&lon=${r4(lon)}&distance=${distance}&format=compressed`, { timeout: 20000 });
}

export async function searchPlaces(q) {
  const p = new URLSearchParams({ name: q, count: 20, language: 'de', format: 'json' });
  const d = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?${p}`, { retries: 0 });
  // Große Orte zuerst, exakte Namenstreffer bevorzugt
  const ql = q.trim().toLowerCase();
  const score = r => Math.log10((r.population || 0) + 10) + (r.name.toLowerCase().startsWith(ql) ? 2 : 0);
  return (d.results || []).sort((a, b) => score(b) - score(a)).slice(0, 8).map(r => ({
    name: r.name,
    region: [r.admin1, r.country].filter(Boolean).join(', '),
    lat: r.latitude, lon: r.longitude,
  }));
}

export async function reverseGeocode(lat, lon) {
  try {
    const d = await getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${r4(lat)}&longitude=${r4(lon)}&localityLanguage=de`, { retries: 0, timeout: 6000 });
    return d.city || d.locality || d.principalSubdivision || null;
  } catch { return null; }
}

// Radar-Frames: zlib + base64 → Uint16Array (Einheit 0,01 mm / 5 min)
export async function decodeRadarFrame(b64) {
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('deflate'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint16Array(buf);
}

// Windfeld als Raster um den Ort (ein Aufruf, mehrere Koordinaten)
export async function fetchWindGrid(lat, lon, { nLat = 9, nLon = 11, dLat = 5, dLon = 8 } = {}) {
  const lats = [], lons = [];
  for (let i = 0; i < nLat; i++) for (let j = 0; j < nLon; j++) {
    lats.push(r4(lat - dLat + (2 * dLat * i) / (nLat - 1)));
    lons.push(r4(lon - dLon + (2 * dLon * j) / (nLon - 1)));
  }
  const p = new URLSearchParams({
    latitude: lats.join(','), longitude: lons.join(','),
    current: 'wind_speed_10m,wind_direction_10m', wind_speed_unit: 'kmh', timezone: 'GMT',
  });
  const res = await getJSON(`https://api.open-meteo.com/v1/forecast?${p}`, { timeout: 15000 });
  const arr = Array.isArray(res) ? res : [res];
  const u = new Float32Array(nLat * nLon), v = new Float32Array(nLat * nLon), s = new Float32Array(nLat * nLon);
  arr.forEach((d, k) => {
    const sp = d.current?.wind_speed_10m ?? 0, dir = (d.current?.wind_direction_10m ?? 0) * Math.PI / 180;
    // Richtung ist „woher" → Bewegung in Gegenrichtung
    u[k] = -sp * Math.sin(dir); v[k] = -sp * Math.cos(dir); s[k] = sp;
  });
  return { nLat, nLon, lat0: lat - dLat, lat1: lat + dLat, lon0: lon - dLon, lon1: lon + dLon, u, v, s };
}
