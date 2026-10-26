// Automatic text color (SPEC §9): how bright the photo is under a piece of text. Reads the photo's
// tiny pre-blurred background copy (~48 px, /media/bg/<id>.jpg) into a luminance grid, so it costs
// almost nothing on the frame; the math is in lib/text-style-core.js.

import { photoRect, areaLuminance, hexLuminance } from './lib/text-style-core.js';
import { fillLayout, viewRect } from './lib/photo-core.js';

const KEEP = 4; // grids kept (current photo, a few previous)

export class Brightness {
  constructor() {
    this.grids = new Map(); // slide id -> Promise<{ w, h, data } | null>
  }

  grid(slide) {
    if (!this.grids.has(slide.id)) {
      this.grids.set(slide.id, load(slide.bg));
      while (this.grids.size > KEEP) this.grids.delete(this.grids.keys().next().value);
    }
    return this.grids.get(slide.id);
  }

  /**
   * Luminance (0..1) under `rect` (a DOMRect on the page) for the photo widget whose box is `box`
   * (DOMRect), showing `slide` with slideshow `settings` and `fit` ('fit' | 'fill'), or its saved zoom
   * `view` (SPEC §15). Null if unknown.
   */
  async under(slide, settings, fit, box, rect, view = null) {
    if (!slide || !slide.bg || !slide.width || !slide.height || !box.width || !box.height) return null;
    const lum = await this.grid(slide);
    if (!lum) return null;
    const fill = fit === 'fill';
    const pos = fill ? fillLayout(slide, box.width, box.height) : { px: 50, py: 50 };
    const photo = view ? viewRect(slide, view, box.width, box.height)
      : photoRect(slide.width, slide.height, box.width, box.height, fill, pos.px, pos.py);
    const outside = settings.background === 'blur' ? 'blur'
      : settings.background === 'color' ? hexLuminance(settings.backgroundColor) : 0;
    const area = { x: rect.left - box.left, y: rect.top - box.top, w: rect.width, h: rect.height };
    return areaLuminance(lum, photo, area, box.width, box.height, outside);
  }
}

async function load(url) {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, w, h).data;
    const data = new Float32Array(w * h);
    const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    for (let i = 0; i < w * h; i++) {
      data[i] = 0.2126 * lin(px[i * 4]) + 0.7152 * lin(px[i * 4 + 1]) + 0.0722 * lin(px[i * 4 + 2]);
    }
    return { w, h, data };
  } catch (e) {
    console.error('autocolor: could not read', url, e.message);
    return null;
  }
}
