// `caption` widget (SPEC §8): a bubble in a corner of the photo with the comment, place, and date
// of the photo on screen, like Frameo's caption. Text comes from lib/caption-core.js.

import { captionText } from './lib/caption-core.js';
import { resolveStyle, fontFamily, textColor, shadowCss } from './lib/text-style-core.js';

// A bubble this dark counts as a dark background for the automatic text color.
const DARK_BUBBLE = 0.35;

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

export class Caption {
  /**
   * @param {HTMLElement} root
   * @param {{ config: () => object, tz?: string }} opts config: the current config (reads `caption`)
   */
  constructor(root, opts) {
    this.root = root;
    this.opts = opts;
    this.slide = null;
    this.corner = 'bottom-left';
    this.background = null;
    this.lastColor = null;
    this.bubble = el('div', 'cap');
    this.main = el('div', 'cap-main');
    this.sub = el('div', 'cap-sub');
    this.bubble.append(this.main, this.sub);
    root.append(this.bubble);
    this.render();
  }

  update(spec) {
    if (spec && spec.anchor) this.corner = spec.anchor.corner;
    this.render();
  }

  /** The photo on screen changed (or its comment did). */
  setSlide(slide) {
    const changed = (slide && slide.id) !== (this.slide && this.slide.id);
    this.slide = slide;
    this.render();
    if (changed && !this.bubble.hidden) {
      // Fade in with the new photo.
      this.bubble.classList.remove('cap-in');
      void this.bubble.offsetWidth;
      this.bubble.classList.add('cap-in');
    }
  }

  render() {
    const c = this.opts.config().caption;
    const { main, sub } = captionText(this.slide, c, this.opts.tz);
    this.main.textContent = main || '';
    this.main.hidden = !main;
    this.sub.textContent = sub || '';
    this.sub.hidden = !sub;
    this.bubble.hidden = !main && !sub;
    this.bubble.className = `cap cap-${c.size}${this.corner.endsWith('right') ? ' cap-right' : ''}${this.bubble.classList.contains('cap-in') ? ' cap-in' : ''}`;
    this.bubble.style.background = `rgba(0, 0, 0, ${c.background})`;
    // Text style (SPEC §9): the bubble darkens the photo, so a dark-enough bubble means light text.
    const st = resolveStyle(this.opts.config().text, 'caption');
    const under = c.background >= DARK_BUBBLE ? 0 : this.background;
    const color = textColor(st.color, under, this.lastColor);
    this.lastColor = color;
    Object.assign(this.bubble.style, {
      fontFamily: fontFamily(st.font), fontWeight: st.bold ? '700' : '', color,
      textShadow: shadowCss(color, Math.min(st.shadow, 0.5), st.outline), opacity: String(st.opacity),
    });
  }

  setBackground(luminance) {
    if (luminance === this.background) return;
    this.background = luminance;
    this.render();
  }

  wantsBackground() {
    const c = this.opts.config();
    return !this.bubble.hidden && resolveStyle(c.text, 'caption').color === 'auto' && c.caption.background < DARK_BUBBLE;
  }

  destroy() {
    this.root.innerHTML = '';
  }
}
