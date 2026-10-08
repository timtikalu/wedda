// Windkarte: eingefärbtes Windfeld + fließende Partikel (Open-Meteo-Raster) auf Leaflet.
import { fetchWindGrid } from './data.js';
import { glyph } from './icons.js';

// km/h → Farbe (Apple-ähnlich: ruhig = tiefblau, Sturm = rot/violett)
const STOPS = [[0, [22, 92, 170]], [10, [26, 120, 200]], [20, [36, 160, 205]], [30, [52, 190, 160]],
  [45, [225, 200, 70]], [60, [235, 135, 55]], [80, [215, 65, 55]], [110, [160, 60, 160]]];
function color(sp) {
  let i = STOPS.findIndex(s => s[0] > sp);
  if (i < 0) return STOPS.at(-1)[1];
  if (i === 0) return STOPS[0][1];
  const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i];
  const f = (sp - a) / (b - a);
  return ca.map((c, k) => c + (cb[k] - c) * f);
}
export const WIND_LEGEND = STOPS.map(s => `rgb(${s[1].join(',')})`);

export class WindMap {
  constructor(root) {
    this.root = root;
    this.stage = root.querySelector('.wind-stage');
    this.mapEl = root.querySelector('.wind-map');
    this.expandBtn = root.querySelector('.wind-expand');
    this.expandBtn.innerHTML = glyph('expand', 15);
    this.expandBtn.addEventListener('click', () => this.setExpanded(!this.expanded));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') this.setExpanded(false); });
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.visible = false;
    this.loop = this.loop.bind(this);
    new IntersectionObserver(es => {
      this.visible = es.some(e => e.isIntersecting);
      if (this.visible && this.pending) this.load(...this.pending);
      this.kick();
    }, { rootMargin: '300px' }).observe(root);
    document.addEventListener('visibilitychange', () => this.kick());
  }

  ensureMap() {
    if (this.map || !window.L) return;
    const m = this.map = L.map(this.mapEl, {
      zoomControl: false, attributionControl: true, zoomAnimation: false, fadeAnimation: false,
      dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false,
      minZoom: 4, maxZoom: 9,
    });
    m.attributionControl.setPrefix(false);
    const esri = name => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${name}/MapServer/tile/{z}/{y}/{x}`;
    L.tileLayer(esri('Dark_Gray_Base'), { attribution: 'Karte © Esri · Wind: Open-Meteo' }).addTo(m);
    m.createPane('wfield').style.zIndex = 420;
    m.createPane('wparts').style.zIndex = 430;
    m.createPane('wlabels').style.zIndex = 460;
    m.getPane('wlabels').style.pointerEvents = 'none';
    L.tileLayer(esri('Dark_Gray_Reference'), { pane: 'wlabels' }).addTo(m);
    this.field = L.DomUtil.create('canvas', 'wind-canvas', m.getPane('wfield'));
    this.parts = L.DomUtil.create('canvas', 'wind-canvas', m.getPane('wparts'));
    m.on('move zoom resize viewreset', () => { this.drawField(); this.resetParticles(); });
  }

  async load(lat, lon, speed, label) {
    if (!this.visible) { this.pending = [lat, lon, speed, label]; return; }
    this.pending = null;
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    this.ensureMap();
    if (!this.map) return;
    this.setMarker(lat, lon, speed, label);
    if (this.key === key && Date.now() - this.loadedAt < 30 * 60e3) return;
    this.key = key;
    this.map.setView([lat, lon], this.expanded ? 6 : 5);
    try {
      const grid = await fetchWindGrid(lat, lon);
      if (this.key !== key) return;
      this.grid = grid; this.loadedAt = Date.now();
      this.drawField(); this.resetParticles(); this.kick();
    } catch {
      this.key = null;
    }
  }

  setMarker(lat, lon, speed, label) {
    const html = `<div class="wind-pin"><b>${speed == null ? '–' : Math.round(speed)}</b><span>${label}</span></div>`;
    const icon = L.divIcon({ className: 'wind-pin-wrap', html, iconSize: [0, 0] });
    if (this.marker) this.marker.setLatLng([lat, lon]).setIcon(icon);
    else this.marker = L.marker([lat, lon], { icon, interactive: false, keyboard: false }).addTo(this.map);
  }

  // Bilineare Interpolation im Raster; außerhalb → null
  sample(lat, lon) {
    const g = this.grid;
    if (!g || lat < g.lat0 || lat > g.lat1 || lon < g.lon0 || lon > g.lon1) return null;
    const fi = (lat - g.lat0) / (g.lat1 - g.lat0) * (g.nLat - 1);
    const fj = (lon - g.lon0) / (g.lon1 - g.lon0) * (g.nLon - 1);
    const i = Math.min(g.nLat - 2, Math.floor(fi)), j = Math.min(g.nLon - 2, Math.floor(fj));
    const di = fi - i, dj = fj - j;
    const at = (arr) => {
      const a = arr[i * g.nLon + j], b = arr[i * g.nLon + j + 1], c = arr[(i + 1) * g.nLon + j], d = arr[(i + 1) * g.nLon + j + 1];
      return (a * (1 - dj) + b * dj) * (1 - di) + (c * (1 - dj) + d * dj) * di;
    };
    return { u: at(g.u), v: at(g.v), s: at(g.s) };
  }

  sizeCanvas(cv) {
    const size = this.map.getSize(), dpr = Math.min(devicePixelRatio || 1, 2);
    if (cv.width !== size.x * dpr || cv.height !== size.y * dpr) {
      cv.width = size.x * dpr; cv.height = size.y * dpr;
      cv.style.width = size.x + 'px'; cv.style.height = size.y + 'px';
    }
    L.DomUtil.setPosition(cv, this.map.containerPointToLayerPoint([0, 0]));
    return { w: size.x, h: size.y, dpr };
  }

  drawField() {
    if (!this.map || !this.grid) return;
    const { w, h } = this.sizeCanvas(this.field);
    const step = 6, cw = Math.ceil(w / step), ch = Math.ceil(h / step);
    const off = this.off || (this.off = document.createElement('canvas'));
    off.width = cw; off.height = ch;
    const octx = off.getContext('2d'), img = octx.createImageData(cw, ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const ll = this.map.containerPointToLatLng([x * step + step / 2, y * step + step / 2]);
      const smp = this.sample(ll.lat, ll.lng);
      if (!smp) continue;
      const c = color(smp.s), k = (y * cw + x) * 4;
      img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 205;
    }
    octx.putImageData(img, 0, 0);
    const ctx = this.field.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.field.width, this.field.height);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, 0, 0, cw * step * (this.field.width / w), ch * step * (this.field.height / h));
  }

  resetParticles() {
    if (!this.map) return;
    const { w, h, dpr } = this.sizeCanvas(this.parts);
    this.w = w; this.h = h; this.dpr = dpr;
    const ctx = this.parts.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.parts.width, this.parts.height);
    const n = this.reduced ? 0 : Math.round((w * h) / 380);
    this.ps = Array.from({ length: n }, () => this.spawn(true));
  }
  spawn(randomAge) {
    return { x: Math.random() * this.w, y: Math.random() * this.h, age: randomAge ? Math.floor(Math.random() * 90) : 0, life: 60 + Math.random() * 60 };
  }

  kick() {
    if (this.running || !this.visible || document.hidden || !this.grid || this.reduced) return;
    this.running = true;
    requestAnimationFrame(this.loop);
  }
  loop() {
    if (!this.visible || document.hidden || !this.ps) { this.running = false; return; }
    const ctx = this.parts.getContext('2d'), dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Spuren verblassen lassen
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = 'rgba(0,0,0,0.9)';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    const k = 0.045 * Math.pow(2, this.map.getZoom() - 5) ** 0.5;
    for (let i = 0; i < this.ps.length; i++) {
      const p = this.ps[i];
      const ll = this.map.containerPointToLatLng([p.x, p.y]);
      const smp = this.sample(ll.lat, ll.lng);
      if (!smp || ++p.age > p.life) { this.ps[i] = this.spawn(false); continue; }
      const nx = p.x + smp.u * k, ny = p.y - smp.v * k;
      ctx.moveTo(p.x, p.y); ctx.lineTo(nx, ny);
      p.x = nx; p.y = ny;
      if (nx < 0 || ny < 0 || nx > this.w || ny > this.h) this.ps[i] = this.spawn(false);
    }
    ctx.stroke();
    requestAnimationFrame(this.loop);
  }

  setExpanded(on) {
    if (!this.map || on === !!this.expanded) return;
    this.expanded = on;
    if (on) {
      this.placeholder = document.createComment('wind');
      this.stage.replaceWith(this.placeholder);
      document.body.appendChild(this.stage);
    } else if (this.placeholder) {
      this.placeholder.replaceWith(this.stage);
      this.placeholder = null;
    }
    this.stage.classList.toggle('expanded', on);
    document.body.classList.toggle('modal-open', on);
    this.expandBtn.innerHTML = glyph(on ? 'close' : 'expand', 15);
    const m = this.map;
    for (const h of ['dragging', 'touchZoom', 'scrollWheelZoom', 'doubleClickZoom']) on ? m[h].enable() : m[h].disable();
    requestAnimationFrame(() => {
      m.invalidateSize();
      if (this.marker) m.setView(this.marker.getLatLng(), on ? 6 : 5);
      this.drawField(); this.resetParticles();
    });
  }
}
