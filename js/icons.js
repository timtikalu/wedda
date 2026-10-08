// Mehrfarbige Wetter-Symbole im Stil der SF Symbols. Verläufe sind in index.html (#defs) definiert.
import { category } from './essence.js';

const sun = (cx = 32, cy = 32, r = 11, rays = true) => `
  ${rays ? `<g stroke="#FFC53D" stroke-width="3.6" stroke-linecap="round">${
    Array.from({ length: 8 }, (_, i) => {
      const a = i * Math.PI / 4, r1 = r + 5, r2 = r + 10;
      return `<line x1="${(cx + Math.cos(a) * r1).toFixed(1)}" y1="${(cy + Math.sin(a) * r1).toFixed(1)}" x2="${(cx + Math.cos(a) * r2).toFixed(1)}" y2="${(cy + Math.sin(a) * r2).toFixed(1)}"/>`;
    }).join('')}</g>` : ''}
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#gSun)"/>`;

const moon = (tx = 0, ty = 0, s = 1) =>
  `<path transform="translate(${tx} ${ty}) scale(${s})" fill="url(#gMoon)" d="M40.5 12.5a20 20 0 1 0 13 30.6A17 17 0 0 1 40.5 12.5z"/>`;

const cloudShape = (fill = 'url(#gCloud)', tx = 0, ty = 0, s = 1) => `
  <g transform="translate(${tx} ${ty}) scale(${s})" fill="${fill}">
    <circle cx="22" cy="38" r="10"/><circle cx="35" cy="30" r="14"/><circle cx="47" cy="39" r="9"/>
    <rect x="12" y="37" width="44" height="11" rx="5.5"/>
  </g>`;

const drops = (n = 3, color = '#5AC8FA') => {
  const xs = n === 2 ? [26, 40] : [21, 32, 43];
  return `<g stroke="${color}" stroke-width="3.6" stroke-linecap="round">${xs.map(x => `<line x1="${x}" y1="51" x2="${x - 3}" y2="59"/>`).join('')}</g>`;
};
const flakes = () => `<g fill="#fff">${[[21, 54], [32, 58], [43, 54], [27, 61], [38, 62]].map(([x, y]) => `<circle cx="${x}" cy="${y - 3}" r="2.4"/>`).join('')}</g>`;
const bolt = () => `<path fill="url(#gSun)" d="M33 44h-8l6-11h9l-5 8h7L29 62l4-12z" transform="translate(2 -2)"/>`;
const fogLines = () => `<g stroke="#E3E8EF" stroke-width="3.6" stroke-linecap="round"><line x1="12" y1="52" x2="52" y2="52"/><line x1="18" y1="59" x2="46" y2="59"/></g>`;

export function weatherIcon(code, isDay = true, size = 28) {
  const c = category(code);
  let body;
  const lift = -7;
  switch (c) {
    case 'clear':
      body = isDay ? sun() : moon(-4, 0, 1.05);
      break;
    case 'mostly':
      body = isDay ? sun(26, 24, 10) + cloudShape('url(#gCloud)', 14, 14, 0.75)
                   : moon(-10, -6, 0.9) + cloudShape('url(#gCloud)', 14, 14, 0.75);
      break;
    case 'partly':
      body = isDay ? sun(24, 22, 9) + cloudShape('url(#gCloud)', 4, 4, 0.95)
                   : moon(-12, -8, 0.85) + cloudShape('url(#gCloud)', 4, 4, 0.95);
      break;
    case 'overcast':
      body = cloudShape('url(#gCloudDim)', -2, -6, 0.85) + cloudShape('url(#gCloud)', 2, 2, 0.95);
      break;
    case 'fog':
      body = cloudShape('url(#gCloud)', 0, lift - 2) + fogLines();
      break;
    case 'drizzle':
      body = cloudShape('url(#gCloud)', 0, lift) + drops(2);
      break;
    case 'rain':
      body = cloudShape('url(#gCloud)', 0, lift) + drops(3);
      break;
    case 'snow':
      body = cloudShape('url(#gCloud)', 0, lift) + flakes();
      break;
    case 'thunder':
      body = cloudShape('url(#gCloudDim)', 0, lift) + bolt();
      break;
    default:
      body = cloudShape();
  }
  return `<svg class="wx" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">${body}</svg>`;
}

// Kleine Glyphen für Kartenköpfe (monochrom, currentColor)
const G = {
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14" rx="3"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  umbrella: '<path d="M3.5 12a8.5 8.5 0 0 1 17 0z"/><path d="M12 12v6.5a2 2 0 0 1-4 0"/>',
  radar: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6-6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  sunset: '<path d="M4 18h16M7 14.5a5 5 0 0 1 10 0M12 4v5M9.5 6.5L12 4l2.5 2.5"/>',
  sunrise: '<path d="M4 18h16M7 14.5a5 5 0 0 1 10 0M12 4v5M9.5 6.5L12 9l2.5-2.5"/>',
  wind: '<path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h8"/>',
  drop: '<path d="M12 3.5s6 6.5 6 10.5a6 6 0 0 1-12 0c0-4 6-10.5 6-10.5z"/>',
  thermo: '<path d="M10 4.5a2 2 0 0 1 4 0v9.3a4 4 0 1 1-4 0z"/><path d="M12 10v6"/>',
  humidity: '<path d="M12 3.5s6 6.5 6 10.5a6 6 0 0 1-12 0c0-4 6-10.5 6-10.5z"/><path d="M9 15l6-4"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  gauge: '<path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path d="M12 13l4-4"/>',
  leaf: '<path d="M5 19c0-9 6-14 15-14 0 9-5 15-14 15"/><path d="M5 19l8-8"/>',
  moon: '<path d="M18.5 15A7.5 7.5 0 0 1 9 5.5a7.5 7.5 0 1 0 9.5 9.5z"/>',
  models: '<circle cx="6" cy="16" r="2.5"/><circle cx="12" cy="8" r="2.5"/><circle cx="18" cy="14" r="2.5"/><path d="M7.5 14l3-4M13.7 9.6l2.8 2.8"/>',
  warning: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4M12 16.8v.2"/>',
  list: '<path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11"/><circle cx="4.5" cy="6.5" r=".6"/><circle cx="4.5" cy="12" r=".6"/><circle cx="4.5" cy="17.5" r=".6"/>',
  location: '<path d="M20 4L4 11l7 2 2 7z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.7v.2"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  dropFill: '<path d="M12 3.5s6 6.5 6 10.5a6 6 0 0 1-12 0c0-4 6-10.5 6-10.5z" fill="currentColor" stroke="none"/>',
  arrowUp: '<path d="M12 20V5M6.5 10.5L12 5l5.5 5.5"/>',
  cloudsun: '<circle cx="8" cy="8" r="3" fill="currentColor" stroke="none"/><path d="M8 20h9a3.5 3.5 0 0 0 .4-7A5 5 0 0 0 8 13.5 3.3 3.3 0 0 0 8 20z" fill="currentColor" stroke="none"/>',
};
export const glyph = (name, size = 14) =>
  `<svg class="gl" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${G[name] || ''}</svg>`;
