// Weather icons as inline SVG (drawn for OpenFrame; no third-party assets). Keys match
// weather-core.js wmoInfo(): clear-day, clear-night, partly-day, partly-night, cloudy, fog,
// drizzle, rain, sleet, snow, thunder. Colors read on both the white panel and photos.

const SUN = '#f9ab00';
const MOON = '#ffd54f';
const CLOUD = '#b0bec5';
const CLOUD_EDGE = '#90a4ae';
const RAIN = '#4285f4';
const SNOW = '#90caf9';

const sun = (cx, cy, r) => {
  const rays = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const p = (d) => `${(cx + Math.cos(a) * d).toFixed(1)} ${(cy + Math.sin(a) * d).toFixed(1)}`;
    rays.push(`M${p(r + 4)}L${p(r + 9)}`);
  }
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${SUN}"/>` +
    `<path d="${rays.join('')}" stroke="${SUN}" stroke-width="3.5" stroke-linecap="round"/>`;
};

// Crescent: a disc minus an offset disc.
const moon = (cx, cy, r) =>
  `<path d="M${cx + r * 0.35} ${cy - r}A${r} ${r} 0 1 0 ${cx + r} ${cy + r * 0.35}` +
  `A${r * 0.8} ${r * 0.8} 0 0 1 ${cx + r * 0.35} ${cy - r}z" fill="${MOON}"/>`;

const cloud = (dx = 0, dy = 0, s = 1) =>
  `<g transform="translate(${dx} ${dy}) scale(${s})" fill="${CLOUD}" stroke="${CLOUD_EDGE}" stroke-width="1.5">` +
  '<path d="M20 47a10 10 0 0 1-1-20 14 14 0 0 1 27-3 9.5 9.5 0 0 1 1 23z"/></g>';

const drops = (n, len) => {
  const xs = n === 3 ? [22, 32, 42] : [26, 38];
  return `<path d="${xs.map((x) => `M${x} 47l-3 ${len}`).join('')}" stroke="${RAIN}" stroke-width="3.5" stroke-linecap="round"/>`;
};

const flakes = (xs) => xs.map(([x, y]) =>
  `<circle cx="${x}" cy="${y}" r="3" fill="${SNOW}" stroke="${CLOUD_EDGE}" stroke-width="0.8"/>`).join('');

const ICONS = {
  'clear-day': sun(32, 32, 12),
  'clear-night': moon(30, 32, 15),
  'partly-day': sun(24, 22, 9) + cloud(6, 6, 0.9),
  'partly-night': moon(24, 22, 11) + cloud(6, 6, 0.9),
  cloudy: cloud(0, 2),
  fog: cloud(0, -6) + `<path d="M14 48h36M18 55h28" stroke="${CLOUD_EDGE}" stroke-width="3.5" stroke-linecap="round"/>`,
  drizzle: cloud(0, -6) + drops(2, 6),
  rain: cloud(0, -6) + drops(3, 11),
  sleet: cloud(0, -6) + drops(2, 9) + flakes([[32, 53]]),
  snow: cloud(0, -6) + flakes([[22, 50], [32, 56], [42, 50]]),
  thunder: cloud(0, -6) + `<path d="M33 41l-8 12h7l-4 10 11-14h-7l4-8z" fill="${SUN}"/>`,
};

export function weatherIcon(key) {
  return `<svg viewBox="0 0 64 64" aria-hidden="true">${ICONS[key] || ICONS.cloudy}</svg>`;
}
