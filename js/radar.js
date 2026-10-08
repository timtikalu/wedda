// DWD-Radar (RADOLAN RV via Bright Sky) auf einer Leaflet-Karte – inkl. 2-h-Nowcast an der eigenen Position.
import { fetchRadar, decodeRadarFrame } from './data.js';
import { glyph } from './icons.js';

// mm/h → Farbe (angelehnt an die Apple-Radarskala)
const STOPS = [
  [0.1, [150, 205, 255], 0.35], [0.5, [90, 170, 255], 0.6], [1.5, [40, 115, 240], 0.72],
  [3, [40, 190, 110], 0.78], [6, [255, 214, 60], 0.85], [12, [255, 150, 40], 0.9],
  [25, [255, 59, 48], 0.92], [50, [190, 60, 215], 0.95],
];
const LUT = (() => {
  const lut = new Uint8ClampedArray(4096 * 4);
  for (let v = 1; v < 4096; v++) {
    const mmh = v * 0.12;
    if (mmh < STOPS[0][0]) continue;
    let i = STOPS.findIndex(s => s[0] > mmh);
    if (i < 0) i = STOPS.length;
    const a = STOPS[Math.max(0, i - 1)], b = STOPS[Math.min(STOPS.length - 1, i)];
    const f = a === b ? 0 : Math.log(mmh / a[0]) / Math.log(b[0] / a[0]);
    for (let k = 0; k < 3; k++) lut[v * 4 + k] = a[1][k] + (b[1][k] - a[1][k]) * f;
    lut[v * 4 + 3] = 255 * (a[2] + (b[2] - a[2]) * f);
  }
  return lut;
})();

export const RADAR_LEGEND = STOPS.map(s => `rgb(${s[1].join(',')})`);

export class Radar {
  constructor(root) {
    this.root = root;
    this.frames = []; this.idx = 0; this.playing = false;
    this.stage = root.querySelector('.radar');
    this.mapEl = root.querySelector('.radar-map');
    this.timeEl = root.querySelector('.radar-time');
    this.slider = root.querySelector('.radar-slider');
    this.playBtn = root.querySelector('.radar-play');
    this.expandBtn = root.querySelector('.radar-expand');
    this.playBtn.addEventListener('click', () => this.toggle());
    this.slider.addEventListener('input', () => { this.stop(); this.show(+this.slider.value); });
    this.expandBtn.addEventListener('click', () => this.setExpanded(!this.root.classList.contains('expanded')));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') this.setExpanded(false); });
  }

  ensureMap() {
    if (this.map || !window.L) return;
    this.map = L.map(this.mapEl, {
      zoomControl: false, attributionControl: true, zoomAnimation: false,
      dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false,
    });
    this.map.attributionControl.setPrefix(false);
    this.map.createPane('labels').style.zIndex = 460;
    this.map.getPane('labels').style.pointerEvents = 'none';
    this.map.createPane('radar').style.zIndex = 450;
    this.canvas = L.DomUtil.create('canvas', 'radar-canvas', this.map.getPane('radar'));
    this.map.on('move zoom resize viewreset', () => this.draw());
  }

  setTiles(dark) {
    const style = dark ? 'Dark_Gray' : 'Light_Gray';
    if (this.tileStyle === style) return;
    this.tileStyle = style;
    for (const l of this.tileLayers || []) this.map.removeLayer(l);
    const esri = name => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${name}/MapServer/tile/{z}/{y}/{x}`;
    const opts = { maxZoom: 12, minZoom: 5 };
    this.tileLayers = [
      L.tileLayer(esri(`${style}_Base`), { ...opts, attribution: 'Karte © Esri · Radar © DWD' }).addTo(this.map),
      // Ortsnamen über dem Radar
      L.tileLayer(esri(`${style}_Reference`), { ...opts, pane: 'labels' }).addTo(this.map),
    ];
  }

  setExpanded(on) {
    if (!this.map || on === this.root.classList.contains('expanded')) return;
    // fixed-Elemente innerhalb von backdrop-filter würden in der Karte „gefangen" bleiben → an body hängen
    const stage = this.stage;
    if (on && stage.parentElement !== document.body) {
      this.placeholder = document.createComment('radar');
      stage.replaceWith(this.placeholder);
      document.body.appendChild(stage);
    } else if (!on && this.placeholder) {
      this.placeholder.replaceWith(stage);
      this.placeholder = null;
    }
    stage.classList.toggle('expanded', on);
    this.root.classList.toggle('expanded', on);
    document.body.classList.toggle('modal-open', on);
    this.expandBtn.innerHTML = glyph(on ? 'close' : 'expand', 15);
    const m = this.map;
    for (const h of ['dragging', 'touchZoom', 'scrollWheelZoom', 'doubleClickZoom']) on ? m[h].enable() : m[h].disable();
    requestAnimationFrame(() => { m.invalidateSize(); m.setView([this.lat, this.lon], on ? 8 : 9); this.draw(); });
  }

  // Lädt Radar für einen Ort; gibt Zeitreihe (mm/h) an der Position zurück oder null außerhalb DWD-Gebiet.
  async load(lat, lon, { dark }) {
    this.lat = lat; this.lon = lon;
    const raw = await fetchRadar(lat, lon);
    const [top, left, bottom, right] = raw.bbox;
    const W = right - left + 1, H = bottom - top + 1;
    const corners = raw.geometry.coordinates; // [lon,lat]: TL, BL, BR, TR
    const pos = raw.latlon_position;

    const frames = await Promise.all(raw.radar.map(async r => {
      const data = await decodeRadarFrame(r.precipitation_5);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      const img = ctx.createImageData(W, H);
      for (let i = 0; i < data.length; i++) {
        const v = Math.min(4095, data[i]);
        if (!v) continue;
        img.data.set(LUT.subarray(v * 4, v * 4 + 4), i * 4);
      }
      ctx.putImageData(img, 0, 0);
      // Mittel über 3×3 km an der Position
      const px = Math.round(pos.x - 0.5), py = Math.round(pos.y - 0.5);
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = px + dx, y = py + dy;
        if (x >= 0 && y >= 0 && x < W && y < H) { sum += data[y * W + x]; n++; }
      }
      return { t: Date.parse(r.timestamp), cv, mmh: n ? (sum / n) * 0.12 : 0, forecast: !r.source?.startsWith('RADOLAN::RW') && Date.parse(r.timestamp) > Date.now() };
    }));
    frames.sort((a, b) => a.t - b.t);
    this.frames = frames; this.W = W; this.H = H; this.corners = corners;

    this.ensureMap();
    if (this.map) {
      this.setTiles(dark);
      this.map.setView([lat, lon], this.root.classList.contains('expanded') ? 8 : 9);
    }
    this.slider.max = frames.length - 1;
    const now = Date.now();
    let ni = frames.findIndex(f => f.t > now) - 1;
    if (ni < 0) ni = frames.length - 1;
    this.nowIdx = ni;
    this.show(ni);
    return frames.map(f => ({ t: f.t, mmh: f.mmh }));
  }

  show(i) {
    if (!this.frames.length) return;
    this.idx = Math.max(0, Math.min(this.frames.length - 1, i));
    this.slider.value = this.idx;
    const f = this.frames[this.idx];
    const tz = this.tz || undefined;
    const time = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(f.t);
    const rel = this.idx === this.nowIdx ? 'Jetzt' : f.t > Date.now() ? 'Vorhersage' : 'Vergangen';
    this.timeEl.innerHTML = `<b>${time}</b> <span>${rel}</span>`;
    this.draw();
  }

  draw() {
    if (!this.map || !this.canvas || !this.frames.length) return;
    const size = this.map.getSize();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const cv = this.canvas;
    if (cv.width !== size.x * dpr || cv.height !== size.y * dpr) {
      cv.width = size.x * dpr; cv.height = size.y * dpr;
      cv.style.width = size.x + 'px'; cv.style.height = size.y + 'px';
    }
    // Canvas liegt im (verschobenen) Pane → an die Container-Ecke zurücksetzen
    L.DomUtil.setPosition(cv, this.map.containerPointToLayerPoint([0, 0]));
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const p = ll => this.map.latLngToContainerPoint([ll[1], ll[0]]);
    const [TL, BL, , TR] = this.corners.map(p);
    const W = this.W, H = this.H;
    ctx.setTransform(
      dpr * (TR.x - TL.x) / W, dpr * (TR.y - TL.y) / W,
      dpr * (BL.x - TL.x) / H, dpr * (BL.y - TL.y) / H,
      dpr * TL.x, dpr * TL.y,
    );
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.frames[this.idx].cv, 0, 0);

    // Standortpunkt
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const me = this.map.latLngToContainerPoint([this.lat, this.lon]);
    ctx.fillStyle = 'rgba(10,132,255,0.25)';
    ctx.beginPath(); ctx.arc(me.x, me.y, 14, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(me.x, me.y, 7, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#0a84ff'; ctx.beginPath(); ctx.arc(me.x, me.y, 5, 0, 6.283); ctx.fill();
  }

  toggle() { this.playing ? this.stop() : this.play(); }
  play() {
    if (!this.frames.length) return;
    this.playing = true;
    this.playBtn.innerHTML = glyph('pause', 15);
    if (this.idx >= this.frames.length - 1) this.show(0);
    this.timer = setInterval(() => {
      if (this.idx >= this.frames.length - 1) { this.show(this.nowIdx); this.stop(); return; }
      this.show(this.idx + 1);
    }, 420);
  }
  stop() {
    this.playing = false;
    clearInterval(this.timer);
    this.playBtn.innerHTML = glyph('play', 15);
  }
}
