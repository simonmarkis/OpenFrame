// Warning system on screen (SPEC §13): offline and warning icons (bottom-left corner group),
// popups for problems that need attention (calendar feeds), and a details sheet.
// The shell decides what is wrong and remembers dismissals (/api/warnings), so the frame and other
// browsers agree.

import { agoText } from './lib/settings-core.js';

const POLL_MS = 30000;

export const WARNING_ICONS = {
  offline: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4c-1.48 0-2.85.43-4.01 1.17l1.46 1.46a5.497 5.497 0 0 1 8.05 4.87v.5H19c1.66 0 3 1.34 3 3 0 1.13-.64 2.11-1.56 2.62l1.45 1.45C23.16 18.16 24 16.68 24 15c0-2.64-2.05-4.78-4.65-4.96zM3 5.27l2.75 2.74C2.56 8.15 0 10.77 0 14c0 3.31 2.69 6 6 6h11.73l2 2L21 20.73 4.27 4 3 5.27zM7.73 10l8 8H6c-2.21 0-4-1.79-4-4s1.79-4 4-4h1.73z"/></svg>',
  warning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
};

const OFFLINE_TEXT = 'Photos and calendars keep working from what the frame has saved. Calendars and weather update when the connection is back.';

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function text(tag, cls, s) {
  const e = el(tag, cls);
  e.textContent = s;
  return e;
}

/** Polls /api/warnings and notifies listeners when it changes. One per page. */
export class WarningsData {
  constructor() {
    this.value = { online: true, warnings: [] };
    this.key = '';
    this.listeners = new Set();
    this.timer = null;
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  start() {
    if (this.timer) return;
    this.refresh();
    this.timer = setInterval(() => this.refresh(), POLL_MS);
  }

  async refresh() {
    try {
      const res = await fetch('/api/warnings', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const value = await res.json();
      const key = JSON.stringify(value);
      if (key === this.key) return;
      this.key = key;
      this.value = value;
      this.listeners.forEach((fn) => fn(value));
    } catch (e) {
      console.error('warnings: fetch failed', e.message);
    }
  }

  async dismiss(ids) {
    await Promise.all(ids.map((id) => fetch('/api/warnings/dismiss', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
    }).catch((e) => console.error('warnings: dismiss failed', e.message))));
    await this.refresh();
  }
}

/** One warning as a block of text: title, detail, last update. */
function warningBlock(w) {
  const b = el('div', 'wn-item');
  b.append(text('div', 'wn-item-title', w.title), text('div', 'wn-item-detail', w.detail));
  if (w.kind === 'calendar' && w.lastSuccessAt) b.append(text('div', 'wn-item-meta', `Last updated ${agoText(w.lastSuccessAt)}`));
  if (w.kind === 'calendar' && !w.lastSuccessAt) b.append(text('div', 'wn-item-meta', 'Never updated'));
  return b;
}

function modal(title, body, buttons) {
  const backdrop = el('div', 'wn-backdrop');
  const card = el('div', 'wn-card');
  card.setAttribute('role', 'alertdialog');
  card.addEventListener('click', (e) => e.stopPropagation());
  const head = el('div', 'wn-head', WARNING_ICONS.warning);
  head.append(text('h2', '', title));
  const list = el('div', 'wn-list');
  body.forEach((b) => list.append(b));
  const bar = el('div', 'wn-actions');
  buttons.forEach((b) => bar.append(b));
  card.append(head, list, bar);
  backdrop.append(card);
  document.body.append(backdrop);
  return { backdrop, card, close: () => backdrop.remove() };
}

function button(label, cls, onClick) {
  const b = text('button', `wn-btn ${cls || ''}`, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/**
 * Runs down an outline around `btn` over `ms` (like a progress bar) and counts the seconds in `label`;
 * calls `onEnd` when the time is up. Returns a stop function.
 */
export function countdown(btn, label, ms, onEnd) {
  const NS = 'http://www.w3.org/2000/svg';
  const GAP = 4, STROKE = 4, PAD = GAP + STROKE;
  const w = btn.offsetWidth + 2 * GAP + STROKE, h = btn.offsetHeight + 2 * GAP + STROKE, r = h / 2;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'wn-ring');
  svg.setAttribute('width', w + STROKE);
  svg.setAttribute('height', h + STROKE);
  svg.style.left = svg.style.top = `${-PAD}px`;
  // The pill's outline as one path from the top middle, clockwise; the gap grows from there, so its moving
  // edge goes round like a clock hand (user 2026-10-26).
  const x0 = STROKE / 2, y0 = STROKE / 2, x1 = x0 + w, y1 = y0 + h;
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', `M ${x0 + w / 2} ${y0} H ${x1 - r} A ${r} ${r} 0 0 1 ${x1 - r} ${y1} H ${x0 + r} A ${r} ${r} 0 0 1 ${x0 + r} ${y0} Z`);
  const length = 2 * (w - 2 * r) + 2 * Math.PI * r;
  path.style.strokeDasharray = `${length}`;
  svg.append(path);
  btn.append(svg);
  path.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: -length }], { duration: ms, easing: 'linear', fill: 'forwards' });

  const end = Date.now() + ms;
  const tick = () => {
    const left = end - Date.now();
    if (left <= 0) { stop(); onEnd(); return; }
    const s = Math.ceil(left / 1000);
    label.textContent = s > 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s`;
  };
  const timer = setInterval(tick, 250);
  const stop = () => { clearInterval(timer); svg.remove(); };
  tick();
  return stop;
}

const AUTO_CLOSE_MS = 60000;

/** "Calendar problem", "Upload problem", or a count; mixed kinds are just "problems". */
export function popupTitle(warnings) {
  const n = warnings.length;
  const kinds = new Set(warnings.map((w) => w.kind));
  const what = kinds.size === 1 ? ({ calendar: 'calendar', upload: 'upload' })[warnings[0].kind] : null;
  if (n === 1) return what ? `${what[0].toUpperCase()}${what.slice(1)} problem` : 'Problem';
  return what ? `${n} ${what} problems` : `${n} problems`;
}

/**
 * Popups for warnings the shell marks `popup` (calendar feeds), one dialog for all of them.
 * OK dismisses them, and so does the minute running out (user 2026-10-26); the corner icon stays
 * until the problem is fixed.
 */
export class WarningPopups {
  constructor(data, opts = {}) {
    this.data = data;
    this.opts = opts;
    this.open = null; // { ids, modal, stop }
    this.dismissing = new Set(); // OK pressed, dismissal on its way: don't reopen meanwhile
    data.onChange((v) => this.update(v));
    this.update(data.value);
  }

  close() {
    if (!this.open) return;
    this.open.stop();
    this.open.modal.close();
    this.open = null;
  }

  update(v) {
    const pending = v.warnings.filter((w) => w.popup && !this.dismissing.has(w.id));
    const ids = pending.map((w) => w.id).join(',');
    if (this.open && this.open.ids === ids) return;
    this.close();
    if (!pending.length) return;
    const title = popupTitle(pending);
    const dismiss = () => {
      this.close();
      const done = pending.map((w) => w.id);
      done.forEach((id) => this.dismissing.add(id));
      this.data.dismiss(done).finally(() => done.forEach((id) => this.dismissing.delete(id)));
    };
    const ok = button('OK', 'primary wn-timed', dismiss);
    const left = text('span', 'wn-countdown', '');
    const m = modal(title, [...pending.map(warningBlock),
      text('p', 'wn-hint', 'After OK, or after a minute, a warning icon stays in the bottom-left corner until this is fixed.')], [left, ok]);
    this.open = { ids, modal: m, stop: countdown(ok, left, AUTO_CLOSE_MS, dismiss) };
  }
}

/** Opens the list of everything currently wrong (from the corner icons). */
export function openWarningsSheet(v, opts = {}) {
  const body = [];
  if (!v.online) {
    const b = el('div', 'wn-item');
    b.append(text('div', 'wn-item-title', 'No internet connection'), text('div', 'wn-item-detail', OFFLINE_TEXT));
    body.push(b);
  }
  v.warnings.forEach((w) => body.push(warningBlock(w)));
  if (!body.length) body.push(text('p', 'wn-hint', 'Nothing is wrong right now.'));
  const buttons = [];
  let m = null;
  if (opts.onSettings) buttons.push(button('Settings', '', () => { m.close(); opts.onSettings(); }));
  buttons.push(button('Close', 'primary', () => m.close()));
  const count = v.warnings.length + (v.online ? 0 : 1);
  m = modal(count === 1 ? 'Something needs attention' : `${count} things need attention`, body, buttons);
  m.backdrop.addEventListener('click', () => m.close());
  return m;
}

/** `status` widget: the offline and warning icons, bottom-left; hidden when all is well. */
export class StatusIcons {
  constructor(root, data, opts = {}) {
    this.root = root;
    this.data = data;
    root.classList.add('wn-status');
    this.offline = el('button', 'wn-icon wn-offline', WARNING_ICONS.offline);
    this.offline.setAttribute('aria-label', 'No internet connection');
    this.warn = el('button', 'wn-icon wn-warn', WARNING_ICONS.warning);
    this.warn.setAttribute('aria-label', 'Warnings');
    const open = () => openWarningsSheet(this.data.value, opts);
    this.offline.addEventListener('click', open);
    this.warn.addEventListener('click', open);
    root.append(this.offline, this.warn);
    this.unsubscribe = data.onChange(() => this.render());
    this.render();
  }

  render() {
    const v = this.data.value;
    this.offline.hidden = v.online;
    this.warn.hidden = v.warnings.length === 0;
    this.root.hidden = v.online && v.warnings.length === 0;
    document.body.classList.toggle('has-status', !this.root.hidden); // lifts a caption in that corner
  }

  destroy() {
    this.unsubscribe();
    document.body.classList.remove('has-status');
    this.root.innerHTML = '';
    this.root.className = '';
  }
}
