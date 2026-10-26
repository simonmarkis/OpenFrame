// Dark mode switch for a page (SPEC §9, Phase 11c): sets data-theme on <html> (dark.css), and
// remembers it so the next page load starts in the right theme without a white flash.
// data-panel-theme is the day panel's and clock panel's own look (Hybrid's right-hand column):
// Light, Dark, or the same as the theme (config theme.panel, 2026-10-16).

import { isDark, panelTheme } from './lib/theme-core.js';
import { sunTimes } from './lib/weather-core.js';

const KEY = 'of-theme';
const PANEL_KEY = 'of-panel-theme';

/** Applies the theme for `config` now; `weather` = /api/weather value (sunset mode). True if it changed. */
export function applyTheme(config, weather) {
  const dark = isDark(config.theme, { now: new Date(), sun: sunTimes(weather), schedules: config.sleep.schedules });
  const value = dark ? 'dark' : 'light';
  const panel = panelTheme(config.theme, value);
  const root = document.documentElement;
  if (root.dataset.theme === value && root.dataset.panelTheme === panel) return false;
  root.dataset.theme = value;
  root.dataset.panelTheme = panel;
  try {
    localStorage.setItem(KEY, value);
    localStorage.setItem(PANEL_KEY, panel);
  } catch (e) { /* private mode: no memory, that's fine */ }
  return true;
}
