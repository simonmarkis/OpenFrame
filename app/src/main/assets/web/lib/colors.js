// Small color helpers (Chromium 106 has no color-mix()).

/** Tint of a #rrggbb color over `base` (default white): `amount` 0 = base, 1 = the color itself. */
export function tint(hex, amount, base = '#ffffff') {
  const n = parseInt(hex.slice(1), 16);
  const b = parseInt(base.slice(1), 16);
  const mix = (c, k) => Math.round(c * amount + k * (1 - amount));
  return `rgb(${mix(n >> 16, b >> 16)}, ${mix((n >> 8) & 255, (b >> 8) & 255)}, ${mix(n & 255, b & 255)})`;
}

/** Dark mode is on (SPEC §9, `data-theme` on <html>); false outside a browser (tests). */
export function isDarkTheme() {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';
}

/** The day panel and clock panel are dark (their own setting, or the theme; SPEC §9). */
export function isDarkPanel() {
  return typeof document !== 'undefined' && document.documentElement.dataset.panelTheme === 'dark';
}

// ---- Dark mode event colors (SPEC §9: like Google Calendar's dark mode, user 2026-10-16) ----

const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const hexOf = (rgb) => `#${rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')}`;

function toHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** WCAG relative luminance of a #rrggbb color. */
export function luminance(hex) {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = rgbOf(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of two #rrggbb colors (1–21). */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const FILL_MIN_LUMINANCE = 0.3; // with DARK_INK-like text: contrast ≥ 5.5
const darkCache = new Map();

/**
 * A calendar's event fill in dark mode: its color slightly muted and lightened until dark text
 * reads well on it (bright and solid, like Google Calendar's dark mode), and that dark text.
 */
export function darkEventColors(hex) {
  const key = String(hex).toLowerCase();
  let out = darkCache.get(key);
  if (out) return out;
  const [h, s0, l0] = toHsl(rgbOf(/^#[0-9a-f]{6}$/.test(key) ? key : '#888888'));
  const s = Math.min(s0, 0.8) * 0.85;
  let l = Math.max(l0, 0.55);
  let fill = hexOf(fromHsl(h, s, l));
  while (luminance(fill) < FILL_MIN_LUMINANCE && l < 0.9) {
    l += 0.02;
    fill = hexOf(fromHsl(h, s, l));
  }
  const ink = hexOf(fromHsl(h, Math.min(s, 0.45), 0.11));
  out = { fill, ink };
  darkCache.set(key, out);
  return out;
}

/**
 * The "Now" outline and badge in light mode: the calendar's color, darkened until white text on it
 * reads well (≥ 4.5:1), so a light color like Banana still stands out on its pale card.
 */
export function nowAccent(hex) {
  const key = `now:${String(hex).toLowerCase()}`;
  let out = darkCache.get(key);
  if (out) return out;
  const [h, s, l0] = toHsl(rgbOf(/^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : '#888888'));
  let l = Math.min(l0, 0.6);
  out = hexOf(fromHsl(h, s, l));
  while (contrast(out, '#ffffff') < 4.5 && l > 0.05) {
    l -= 0.02;
    out = hexOf(fromHsl(h, s, l));
  }
  darkCache.set(key, out);
  return out;
}

/** Background of an event card in a calendar's color: a light tint, or in dark mode a bright solid fill. */
export function cardTint(hex, amount, dark = isDarkTheme()) {
  return dark ? darkEventColors(hex).fill : tint(hex, amount);
}

/** Text on an event card in that calendar's color. */
export function cardText(hex, dark = isDarkTheme()) {
  return dark ? darkEventColors(hex || '#888888').ink : '#202124';
}

/** The colored left edge of an event: the calendar's color, or (dark mode) none, like Google Calendar. */
export function cardEdge(hex, dark = isDarkTheme()) {
  return dark ? darkEventColors(hex).fill : hex;
}
