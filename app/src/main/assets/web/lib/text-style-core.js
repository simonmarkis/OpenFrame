// Text style (SPEC §9, Phase 11): fonts, one default style for all text with per-item overrides,
// and automatic color from the photo's brightness. Pure; shared by the frame UI, settings, and the
// Node tests (tests/layout/).

/** The frame's own fonts, bundled in fonts/ (fonts.css) so other browsers draw the same. */
export const FONTS = [
  { id: 'roboto', label: 'Roboto', note: 'Standard', family: '"OF Roboto", Roboto, sans-serif' },
  { id: 'roboto-condensed', label: 'Roboto Condensed', note: 'Narrow', family: '"OF Roboto Condensed", "Roboto Condensed", sans-serif' },
  { id: 'noto-serif', label: 'Noto Serif', note: 'Classic', family: '"OF Noto Serif", "Noto Serif", serif' },
  { id: 'dancing-script', label: 'Dancing Script', note: 'Handwriting', family: '"OF Dancing Script", "Dancing Script", cursive' },
  { id: 'coming-soon', label: 'Coming Soon', note: 'Casual', family: '"OF Coming Soon", "Coming Soon", sans-serif' },
  { id: 'cutive-mono', label: 'Cutive Mono', note: 'Typewriter', family: '"OF Cutive Mono", "Cutive Mono", monospace' },
];
export const FONT_IDS = FONTS.map((f) => f.id);

/** Items with their own overrides; the calendar takes only a font and a text size. */
export const ITEMS = ['clock', 'date', 'weather', 'caption'];

export const AUTO = 'auto';
export const WHITE = '#ffffff';
/** Text color used by Automatic on bright photos. */
export const DARK_TEXT = '#202124';

export function fontFamily(id) {
  return (FONTS.find((f) => f.id === id) || FONTS[0]).family;
}

/**
 * The style for one item: the item's overrides (non-null values) over the default style.
 * @returns {{ font, bold, color, shadow, outline, opacity }} color may be 'auto'
 */
export function resolveStyle(text, item) {
  const o = (item && text[item]) || {};
  const pick = (k) => (o[k] !== null && o[k] !== undefined ? o[k] : text[k]);
  return {
    font: pick('font'), bold: pick('bold'), color: pick('color'),
    shadow: text.shadow, outline: text.outline, opacity: text.opacity,
  };
}

/** Relative luminance (0..1) of '#rrggbb'. */
export function hexLuminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

/**
 * The text color to draw with: a fixed color, or for 'auto' white on dark backgrounds and dark text
 * on bright ones (`background` = luminance 0..1 under the text; null = unknown → white). A little
 * hysteresis (`previous`) keeps it from flipping on photos in between.
 */
export function textColor(color, background, previous) {
  if (color !== AUTO) return color;
  if (background === null || background === undefined) return WHITE;
  const limit = previous === DARK_TEXT ? 0.33 : 0.4; // linear luminance: 0.4 ≈ sRGB 170 (bright)
  return background > limit ? DARK_TEXT : WHITE;
}

/**
 * CSS text-shadow for text of `color`: a dark shadow under light text and a light glow around dark
 * text, scaled by `shadow` (0..1); `outline` adds a thin contrasting edge.
 */
export function shadowCss(color, shadow, outline) {
  const light = hexLuminance(color) > 0.35;
  const rgb = light ? '0,0,0' : '255,255,255';
  const a = Math.max(0, Math.min(1, Number(shadow) || 0));
  const k = (f) => Math.min(1, a * f).toFixed(2);
  const parts = [];
  if (outline) {
    for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1.5], [0, -1.5], [1.5, 0], [-1.5, 0]]) {
      parts.push(`${x}px ${y}px 0 rgba(${rgb},0.85)`);
    }
  }
  if (a > 0) parts.push(`1px 2px 2px rgba(${rgb},${k(1.3)})`, `0 0 3px rgba(${rgb},${k(0.8)})`, `0 0 14px rgba(${rgb},${k(0.7)})`);
  return parts.length ? parts.join(', ') : 'none';
}

/** CSS filter for icons drawn next to the text (weather): same shadow idea as shadowCss. */
export function iconShadowCss(color, shadow) {
  const light = hexLuminance(color) > 0.35;
  const rgb = light ? '0,0,0' : '255,255,255';
  const a = Math.max(0, Math.min(1, Number(shadow) || 0));
  if (a <= 0) return 'none';
  const k = (f) => Math.min(1, a * f).toFixed(2);
  return `drop-shadow(1px 2px 2px rgba(${rgb},${k(1.3)})) drop-shadow(0 0 6px rgba(${rgb},${k(0.6)}))`;
}

/** One-line summary of an item's overrides for the settings list. */
export function overrideSummary(o, labelOfFont) {
  const parts = [];
  if (o.font) parts.push(labelOfFont(o.font));
  if (o.color) parts.push(o.color === AUTO ? 'automatic color' : o.color.toUpperCase());
  if (o.bold === true) parts.push('bold');
  if (o.bold === false) parts.push('not bold');
  if (o.size && o.size !== 'medium') parts.push(`${o.size} text`);
  return parts.length ? parts.join(', ') : 'Same as all text';
}

// ---- Automatic color: brightness under a piece of text ----

/**
 * Where the photo is drawn inside its box: { x, y, w, h } in box pixels.
 * fit: contained and centered; fill: covering, offset by object-position (px, py in percent).
 */
export function photoRect(imgW, imgH, boxW, boxH, fill, px = 50, py = 50) {
  const s = fill ? Math.max(boxW / imgW, boxH / imgH) : Math.min(boxW / imgW, boxH / imgH);
  const w = imgW * s;
  const h = imgH * s;
  return { x: (boxW - w) * (px / 100), y: (boxH - h) * (py / 100), w, h };
}

/**
 * Average luminance (0..1) of `area` ({ x, y, w, h } in box pixels) of a photo box.
 * `lum`: { w, h, data: Float32Array } luminance grid of the photo (the small background copy);
 * `photo`: photoRect of the photo; `outside`: luminance where the photo doesn't reach — a number
 * (black or a color background) or 'blur' (the blurred photo, stretched to cover the box).
 */
export function areaLuminance(lum, photo, area, boxW, boxH, outside) {
  const cover = photoRect(lum.w, lum.h, boxW, boxH, true);
  const steps = 6;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const x = area.x + (area.w * (i + 0.5)) / steps;
      const y = area.y + (area.h * (j + 0.5)) / steps;
      let v;
      if (x >= photo.x && x < photo.x + photo.w && y >= photo.y && y < photo.y + photo.h) {
        v = sample(lum, (x - photo.x) / photo.w, (y - photo.y) / photo.h);
      } else if (outside === 'blur') {
        v = sample(lum, (x - cover.x) / cover.w, (y - cover.y) / cover.h);
      } else {
        v = outside;
      }
      sum += v;
      n++;
    }
  }
  return n ? sum / n : 0;
}

function sample(lum, fx, fy) {
  const x = Math.min(lum.w - 1, Math.max(0, Math.floor(fx * lum.w)));
  const y = Math.min(lum.h - 1, Math.max(0, Math.floor(fy * lum.h)));
  return lum.data[y * lum.w + x];
}
