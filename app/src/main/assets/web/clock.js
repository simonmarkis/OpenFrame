// `clock_weather` widget (SPEC §8, §12): time, date, and weather.
// Two styles: 'panel' (Frameo-style block at the top of the Hybrid landscape calendar column)
// and 'overlay' (text with a shadow, anchored in a corner over the photo). Fonts, colors, and
// shadow come from the text style (config.text, SPEC §9).

import { summarize, showHighLow, nextDays } from './lib/weather-core.js';
import { weatherIcon } from './lib/weather-icons.js';
import { clockKnown, onClockKnown, UNKNOWN } from './lib/clock-trust.js';
import { resolveStyle, fontFamily, textColor, shadowCss, iconShadowCss } from './lib/text-style-core.js';

const WEATHER_POLL_MS = 120000; // local request; the native side fetches Open-Meteo every 30 min
const SIZES = { small: 0.8, medium: 1, large: 1.3 };
/** The Hybrid clock panel's text for each size (its box also grows: PANEL_ROWS in layout-core). */
const PANEL_SIZES = { small: 0.88, medium: 1, large: 1.14 };

/** Polls /api/weather and notifies listeners when it changes. Shared by all clock widgets. */
export class WeatherData {
  constructor() {
    this.value = null;
    this.key = '';
    this.listeners = new Set();
    this.timer = null;
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  start() {
    if (this.timer) return;
    this.refresh();
    this.timer = setInterval(() => this.refresh(), WEATHER_POLL_MS);
  }

  async refresh() {
    try {
      const res = await fetch('/api/weather', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const value = await res.json();
      // Location just set or changed: the first forecast is seconds away, check back soon.
      clearTimeout(this.soon);
      if (value.configured && !value.forecast && value.status !== 'error') {
        this.soon = setTimeout(() => this.refresh(), 10000);
      }
      const key = JSON.stringify(value);
      if (key === this.key) return;
      this.key = key;
      this.value = value;
      this.listeners.forEach((fn) => fn());
    } catch (e) {
      console.error('weather: fetch failed', e.message);
    }
  }
}

function el(tag, cls) {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

export class ClockWeather {
  /**
   * @param {HTMLElement} root
   * @param {{ config: () => object, weather: WeatherData, tz?: string }} ctx
   */
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    this.spec = null;
    this.formatKey = '';
    this.timer = null;
    this.background = null; // luminance under the overlay (automatic color); null = unknown
    this.lastColor = {};

    root.classList.add('cw');
    this.main = el('div', 'cw-main');
    this.time = el('div', 'cw-time');
    this.hm = el('span', 'cw-hm');
    this.ampm = el('span', 'cw-ampm');
    this.time.append(this.hm, this.ampm);
    this.date = el('div', 'cw-date');
    this.main.append(this.time, this.date);

    this.wx = el('div', 'cw-wx');
    this.wxNow = el('div', 'cw-wx-now');
    this.icon = el('span', 'cw-icon');
    this.temp = el('span', 'cw-temp');
    this.wxNow.append(this.icon, this.temp);
    this.hilo = el('div', 'cw-hilo');
    this.wx.append(this.wxNow, this.hilo);
    // Over the photo only: condition / feels like / rain line, and the next days.
    this.more = el('div', 'cw-more');
    this.extra = el('div', 'cw-extra');
    this.days = el('div', 'cw-days');
    this.more.append(this.extra, this.days);
    // One-line layout (like Frameo's "Oct 14 ☀ 53°"): the date and weather share a row.
    this.line = el('div', 'cw-line');
    root.append(this.main, this.wx, this.more);
    this.iconFilter = '';
    this.daysKey = '';

    this.unsubscribe = ctx.weather.onChange(() => this.renderWeather());
    this.unClock = onClockKnown(() => { clearTimeout(this.timer); this.tick(); }); // network time arrived
    ctx.weather.start();
    this.tick();
  }

  /** New layout spec (style may switch between panel and overlay on rotation) or settings. */
  update(spec) {
    this.spec = spec;
    const c = this.ctx.config().clock;
    const style = spec.style === 'panel' ? 'panel' : 'overlay';
    this.root.classList.toggle('cw-panel', style === 'panel');
    this.root.classList.toggle('cw-overlay', style === 'overlay');
    const corner = spec.anchor ? spec.anchor.corner : 'top-right';
    this.root.classList.toggle('cw-right', style === 'overlay' && corner.endsWith('right'));

    this.root.style.fontSize = style === 'overlay' ? `${16 * (SIZES[c.size] || 1)}px` : '';
    this.root.style.setProperty('--cw-size', String(style === 'panel' ? PANEL_SIZES[c.size] || 1 : 1));
    // The panel shows condition / feels like / rain under the high and low (user decision 2026-10-16).
    if (style === 'panel' && this.more.parentNode !== this.wx) this.wx.append(this.more);
    else if (style !== 'panel' && this.more.parentNode !== this.root) this.root.append(this.more);
    const oneLine = style === 'overlay' && c.weatherLayout === 'line';
    if (oneLine && this.line.parentNode !== this.main) {
      this.line.append(this.date, this.wx);
      this.main.append(this.line);
    } else if (!oneLine && this.line.parentNode) {
      this.main.append(this.date);
      this.root.insertBefore(this.wx, this.more);
      this.line.remove();
    }
    this.root.classList.toggle('cw-oneline', oneLine);
    this.applyText();
    this.time.hidden = !c.showClock;
    this.date.hidden = !c.showDate;
    this.renderTime();
    this.renderWeather();
  }

  /** Luminance (0..1) of the photo under the overlay, for the automatic text color (null = unknown). */
  setBackground(luminance) {
    if (luminance === this.background) return;
    this.background = luminance;
    this.applyText();
  }

  /** Whether any of this widget's text uses the automatic color. */
  wantsBackground() {
    const text = this.ctx.config().text;
    return this.root.classList.contains('cw-overlay')
      && ['clock', 'date', 'weather'].some((item) => resolveStyle(text, item).color === 'auto');
  }

  /**
   * Fonts and boldness everywhere; colors, shadow/outline, and opacity only over the photo (the
   * panel keeps its own colors; dark mode changes them).
   */
  applyText() {
    const text = this.ctx.config().text;
    const overlay = this.root.classList.contains('cw-overlay');
    for (const [item, node] of [['clock', this.time], ['date', this.date], ['weather', this.wx]]) {
      const st = resolveStyle(text, item);
      node.style.fontFamily = fontFamily(st.font);
      node.style.fontWeight = st.bold ? '700' : '';
      if (item === 'clock') this.hm.style.fontWeight = st.bold ? '700' : '';
      if (overlay) {
        const color = textColor(st.color, this.background, this.lastColor[item]);
        this.lastColor[item] = color;
        node.style.color = color;
        node.style.textShadow = shadowCss(color, st.shadow, st.outline);
        node.style.opacity = String(st.opacity);
        if (item === 'weather') {
          // Icons in the text color (setting) are first made one solid color, then shadowed.
          const mono = this.ctx.config().clock.iconStyle === 'text'
            ? (color === '#ffffff' ? 'brightness(0) invert(1) ' : `brightness(0) invert(${color === '#202124' ? 0.13 : 1}) `) : '';
          const shadow = iconShadowCss(color, st.shadow);
          this.iconFilter = `${mono}${shadow === 'none' ? '' : shadow}`.trim();
          // The extra weather lines share the weather item's look.
          Object.assign(this.more.style, { color, textShadow: node.style.textShadow, opacity: node.style.opacity,
            fontFamily: node.style.fontFamily, fontWeight: node.style.fontWeight });
        }
      } else {
        node.style.color = '';
        node.style.textShadow = '';
        node.style.opacity = '';
        if (item === 'weather') this.iconFilter = '';
      }
    }
    this.root.querySelectorAll('.cw-icon').forEach((i) => { i.style.filter = this.iconFilter || ''; });
  }

  destroy() {
    clearTimeout(this.timer);
    this.unsubscribe();
    this.unClock();
    this.root.innerHTML = '';
    this.root.className = '';
    this.root.removeAttribute('style');
  }

  /** Re-renders at each minute boundary (cheaper than a per-second timer on this CPU). */
  tick() {
    this.renderTime();
    this.renderWeather(); // "current" turns into today's forecast when the cache gets old
    const now = Date.now();
    this.timer = setTimeout(() => this.tick(), 60000 - (now % 60000) + 50);
  }

  formatters() {
    const c = this.ctx.config().clock;
    const oneLine = this.root.classList.contains('cw-oneline');
    const key = `${c.hour12}|${c.dateFormat}|${this.ctx.tz || ''}|${oneLine}`;
    if (key !== this.formatKey) {
      this.formatKey = key;
      const tz = this.ctx.tz ? { timeZone: this.ctx.tz } : {};
      this.timeFmt = new Intl.DateTimeFormat(undefined, { ...tz, hour: 'numeric', minute: '2-digit', hour12: c.hour12 });
      // One line: "Oct 14", like Frameo.
      this.dateFmt = new Intl.DateTimeFormat(undefined, oneLine ? { ...tz, month: 'short', day: 'numeric' }
        : c.dateFormat === 'short'
          ? { ...tz, weekday: 'short', month: 'short', day: 'numeric' }
          : { ...tz, weekday: 'long', month: 'long', day: 'numeric' });
    }
    return this;
  }

  renderTime() {
    if (!this.spec) return;
    if (!clockKnown()) {
      // After a reboot, before network time: the frame's clock is wrong (no battery-backed clock).
      this.hm.textContent = '--:--';
      this.ampm.hidden = true;
      this.date.textContent = UNKNOWN;
      return;
    }
    const { timeFmt, dateFmt } = this.formatters();
    const now = new Date();
    const parts = timeFmt.formatToParts(now);
    this.hm.textContent = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
    const period = parts.find((p) => p.type === 'dayPeriod');
    this.ampm.textContent = period ? period.value : '';
    this.ampm.hidden = !period || !this.ctx.config().clock.showAmPm;
    this.date.textContent = dateFmt.format(now);
  }

  renderWeather() {
    if (!this.spec) return;
    const c = this.ctx.config().clock;
    const show = c.weatherShow;
    // Today's forecast depends on the date, which is wrong until network time (clock-trust.js).
    const s = c.showWeather && clockKnown() ? summarize(this.ctx.weather.value) : null;
    const overlay = this.root.classList.contains('cw-overlay');
    if (s) {
      if (this.iconKey !== s.icon) {
        this.iconKey = s.icon;
        this.icon.innerHTML = weatherIcon(s.icon);
      }
      this.icon.title = s.label;
      this.icon.hidden = !show.icon;
      this.temp.textContent = s.temp === null ? '' : `${s.temp}°`;
      this.temp.hidden = s.temp === null || !show.current;
      const hilo = [];
      if (s.high !== null) hilo.push(`H ${s.high}°`);
      if (s.low !== null) hilo.push(`L ${s.low}°`);
      this.hilo.textContent = hilo.join('  ');
      this.hilo.hidden = hilo.length === 0 || !showHighLow(s, show);
    }
    this.wx.hidden = !s || (this.icon.hidden && this.temp.hidden && this.hilo.hidden);

    // Condition, feels like, rain chance (also in the Hybrid panel), and the next days (over the photo only).
    const extra = !s ? [] : [
      show.condition && s.label,
      show.feelsLike && s.feelsLike !== null && `Feels like ${s.feelsLike}°`,
      show.rain && s.precip !== null && `Rain ${s.precip}%`,
    ].filter(Boolean);
    this.extra.textContent = extra.join(' · ');
    this.extra.hidden = !extra.length;
    const days = s && overlay ? nextDays(this.ctx.weather.value, c.forecastDays) : [];
    const daysKey = JSON.stringify(days);
    if (daysKey !== this.daysKey) {
      this.daysKey = daysKey;
      this.days.innerHTML = '';
      for (const d of days) {
        const cell = el('div', 'cw-day');
        const name = el('span', 'cw-day-name');
        name.textContent = d.day;
        const icon = el('span', 'cw-icon');
        icon.innerHTML = weatherIcon(d.icon);
        icon.title = d.label;
        icon.style.filter = this.iconFilter || '';
        const temps = el('span', 'cw-day-temps');
        temps.textContent = `${d.high ?? '–'}° ${d.low ?? '–'}°`;
        cell.append(name, icon, temps);
        this.days.append(cell);
      }
    }
    this.days.hidden = !days.length;
    this.more.hidden = this.extra.hidden && this.days.hidden;
    this.line.hidden = this.date.hidden && this.wx.hidden;
  }
}
