'use strict';

// Phase 0 test page: proves the shell, the local server and WebView 106 rendering.

function tick() {
  const now = new Date();
  document.getElementById('time').textContent =
    now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  document.getElementById('date').textContent =
    now.toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric' });
}

function renderFacts(status) {
  const chrome = (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || 'unknown';
  const orientation = (screen.orientation && screen.orientation.type) || 'unknown';
  const facts = {
    'Chromium': chrome,
    'Viewport': `${window.innerWidth}×${window.innerHeight} CSS px`,
    'Device pixel ratio': window.devicePixelRatio,
    'Orientation': orientation,
    'Time zone': Intl.DateTimeFormat().resolvedOptions().timeZone,
    'Server': status ? `${status.app} ${status.version}, UI: ${status.uiSource}` : 'unreachable',
    'User agent': navigator.userAgent,
  };
  const dl = document.getElementById('facts');
  dl.replaceChildren();
  for (const [k, v] of Object.entries(facts)) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = String(v);
    dl.append(dt, dd);
  }
}

function renderFeatures() {
  const checks = {
    'CSS grid + gap': () => CSS.supports('gap', '1px'),
    'CSS inset': () => CSS.supports('inset', '0'),
    'CSS aspect-ratio': () => CSS.supports('aspect-ratio', '4 / 3'),
    'CSS :has()': () => CSS.supports('selector(:has(a))'),
    'CSS container queries': () => CSS.supports('container-type', 'inline-size'),
    'Array.prototype.at': () => typeof [].at === 'function',
    'Array.prototype.findLast': () => typeof [].findLast === 'function',
    'Object.hasOwn': () => typeof Object.hasOwn === 'function',
    'structuredClone': () => typeof structuredClone === 'function',
    'ResizeObserver': () => typeof ResizeObserver === 'function',
    'Intl.RelativeTimeFormat': () => typeof Intl.RelativeTimeFormat === 'function',
    'fetch + AbortController': () => typeof fetch === 'function' && typeof AbortController === 'function',
    'localStorage': () => { localStorage.setItem('_t', '1'); localStorage.removeItem('_t'); return true; },
    'Canvas 2D': () => !!document.createElement('canvas').getContext('2d'),
  };
  const ul = document.getElementById('features');
  ul.replaceChildren();
  const failed = [];
  for (const [name, test] of Object.entries(checks)) {
    let ok = false;
    try { ok = !!test(); } catch (e) { ok = false; }
    if (!ok) failed.push(name);
    const li = document.createElement('li');
    li.className = ok ? 'ok' : 'fail';
    li.textContent = name;
    ul.append(li);
  }
  console.log(`feature checks: ${Object.keys(checks).length - failed.length}/${Object.keys(checks).length} ok` +
    (failed.length ? `; missing: ${failed.join(', ')}` : ''));
}

async function loadStatus() {
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch (e) {
    console.error('status fetch failed', e);
    return null;
  }
}

async function main() {
  tick();
  setInterval(tick, 1000);
  renderFeatures();
  const status = await loadStatus();
  renderFacts(status);
  window.addEventListener('resize', () => renderFacts(status));
}

main();
