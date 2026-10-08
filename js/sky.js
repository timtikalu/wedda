// Dynamischer Himmel: Verlauf je nach Wetterlage/Tageszeit + dezente Partikel (Regen, Schnee, Sterne, Wolken).
import { category } from './essence.js';

const PALETTES = {
  clear:    { day: ['#2a6fdb', '#4a9cf0', '#8cc8ff'], night: ['#050b1d', '#0c1a3a', '#1f3463'] },
  mostly:   { day: ['#3474d4', '#5a9ae6', '#9cc6f2'], night: ['#0a1228', '#16264a', '#2b3d63'] },
  partly:   { day: ['#4a7cc0', '#6d97cf', '#a9c3e2'], night: ['#0e1528', '#1b2742', '#313f5c'] },
  overcast: { day: ['#5b6b80', '#7d8b9d', '#a4afbd'], night: ['#161b24', '#232a36', '#363e4c'] },
  fog:      { day: ['#7c8794', '#9aa3ad', '#c3c9cf'], night: ['#1c2027', '#2b3038', '#40464f'] },
  drizzle:  { day: ['#4e5d70', '#6a7889', '#8d99a8'], night: ['#121820', '#1e2530', '#2e3644'] },
  rain:     { day: ['#3e4c5e', '#5a6879', '#7b8797'], night: ['#0d1219', '#1a212b', '#2a323e'] },
  snow:     { day: ['#71839a', '#97a6b8', '#c8d2de'], night: ['#1a2130', '#2a3346', '#46516a'] },
  thunder:  { day: ['#2e3542', '#464e5d', '#646c7a'], night: ['#08090d', '#14161d', '#262a33'] },
};

export function skyPalette(code, isDay) {
  const p = PALETTES[category(code)] || PALETTES.overcast;
  return isDay ? p.day : p.night;
}
export function skyGradient(code, isDay) {
  const [a, b, c] = skyPalette(code, isDay);
  return `linear-gradient(180deg, ${a} 0%, ${b} 55%, ${c} 100%)`;
}

export class Sky {
  constructor(canvas, bgEl) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.bg = bgEl;
    this.particles = []; this.clouds = []; this.mode = null; this.flash = 0;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize = this.resize.bind(this); this.loop = this.loop.bind(this);
    addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.kick(); });
    this.resize();
  }
  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = innerWidth; this.h = innerHeight;
    this.c.width = this.w * dpr; this.c.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.mode) this.seed();
  }
  set(code, isDay, intensity = 1) {
    this.bg.style.background = skyGradient(code, isDay);
    const [top] = skyPalette(code, isDay);
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', top);
    const cat = category(code);
    this.mode = { cat, isDay, intensity };
    this.seed();
    this.kick();
  }
  seed() {
    const { cat, isDay, intensity } = this.mode;
    const area = this.w * this.h / 1e5;
    this.particles = [];
    const n = k => Math.round(k * area * (this.reduced ? 0.3 : 1));
    if (cat === 'rain' || cat === 'thunder' || cat === 'drizzle') {
      const k = cat === 'drizzle' ? 6 : 14 * Math.min(2, Math.max(0.6, intensity));
      for (let i = 0; i < n(k); i++) this.particles.push(this.drop(true));
    } else if (cat === 'snow') {
      for (let i = 0; i < n(9); i++) this.particles.push(this.flake(true));
    } else if (!isDay && (cat === 'clear' || cat === 'mostly' || cat === 'partly')) {
      for (let i = 0; i < n(cat === 'clear' ? 7 : 3); i++) this.particles.push({
        kind: 'star', x: Math.random() * this.w, y: Math.random() * this.h * 0.7,
        r: Math.random() * 1.1 + 0.3, ph: Math.random() * 6.28, sp: 0.5 + Math.random() * 1.5,
      });
    }
    const cloudCount = { clear: 0, mostly: 2, partly: 4, overcast: 6, fog: 6, drizzle: 5, rain: 5, snow: 5, thunder: 6 }[cat] ?? 3;
    this.clouds = Array.from({ length: cloudCount }, (_, i) => ({
      x: Math.random() * this.w * 1.4 - this.w * 0.2,
      y: (i / Math.max(1, cloudCount)) * this.h * 0.45 + Math.random() * 40 - 40,
      s: 180 + Math.random() * 260, v: 4 + Math.random() * 8,
      a: (isDay ? 0.18 : 0.08) * (cat === 'fog' ? 1.6 : 1),
    }));
  }
  drop(randomY) {
    return { kind: 'drop', x: Math.random() * (this.w + 200) - 100, y: randomY ? Math.random() * this.h : -20,
      l: 10 + Math.random() * 16, v: 700 + Math.random() * 500, a: 0.15 + Math.random() * 0.25 };
  }
  flake(randomY) {
    return { kind: 'flake', x: Math.random() * this.w, y: randomY ? Math.random() * this.h : -10,
      r: 1 + Math.random() * 2.6, v: 25 + Math.random() * 45, ph: Math.random() * 6.28, a: 0.5 + Math.random() * 0.45 };
  }
  kick() {
    if (this.running || !this.mode) return;
    this.running = true; this.last = performance.now();
    requestAnimationFrame(this.loop);
  }
  loop(now) {
    if (document.hidden) { this.running = false; return; }
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const t = now / 1000;

    for (const cl of this.clouds) {
      cl.x += cl.v * dt;
      if (cl.x - cl.s > w) cl.x = -cl.s * 1.5;
      const g = ctx.createRadialGradient(cl.x, cl.y, 0, cl.x, cl.y, cl.s);
      g.addColorStop(0, `rgba(255,255,255,${cl.a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(cl.x, cl.y, cl.s * 1.6, cl.s * 0.7, 0, 0, 6.283); ctx.fill();
    }

    ctx.lineCap = 'round';
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.kind === 'drop') {
        p.y += p.v * dt; p.x -= p.v * 0.12 * dt;
        if (p.y > h + 20) this.particles[i] = this.drop(false);
        ctx.strokeStyle = `rgba(200,220,255,${p.a})`; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.l * 0.12, p.y - p.l); ctx.stroke();
      } else if (p.kind === 'flake') {
        p.y += p.v * dt; p.x += Math.sin(t + p.ph) * 12 * dt;
        if (p.y > h + 10) this.particles[i] = this.flake(false);
        ctx.fillStyle = `rgba(255,255,255,${p.a})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      } else {
        const a = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * p.sp + p.ph));
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      }
    }

    if (this.mode?.cat === 'thunder' && !this.reduced) {
      if (this.flash <= 0 && Math.random() < dt * 0.12) this.flash = 1;
      if (this.flash > 0) {
        ctx.fillStyle = `rgba(230,235,255,${this.flash * 0.35})`; ctx.fillRect(0, 0, w, h);
        this.flash -= dt * 3;
      }
    }

    const still = this.reduced || (!this.particles.length && !this.clouds.length);
    if (still) { this.running = false; return; }
    requestAnimationFrame(this.loop);
  }
}
