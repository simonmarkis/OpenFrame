// Dark mode (SPEC §9, Phase 11c): Light, Dark, or Automatic — by sunset/sunrise, around the sleep
// schedule, or between two times. Pure; shared by the frame UI, settings, and the Node tests.

/** Before the sleep time, Automatic "around sleep hours" turns dark this many minutes early. */
export const SLEEP_LEAD_MIN = 120;
/** Without weather (no sunrise/sunset), "sunset to sunrise" uses these. */
export const FALLBACK_SUN = { sunrise: '07:00', sunset: '19:00' };

const minutes = (hm) => {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
};

/** Whether `m` (minutes after midnight) is in [from, to), wrapping past midnight. */
function inRange(m, from, to) {
  return from <= to ? m >= from && m < to : m >= from || m < to;
}

/**
 * Whether the screens should be dark now.
 * @param {{ mode: 'light'|'dark'|'auto', auto: 'sun'|'sleep'|'hours', from: string, to: string }} theme
 * @param {{ now: Date, sun?: { sunrise: string, sunset: string } | null, schedules?: object[] }} ctx
 *   now: local time; sun: today's 'HH:MM'; schedules: config.sleep.schedules
 */
export function isDark(theme, ctx) {
  if (theme.mode === 'dark') return true;
  if (theme.mode !== 'auto') return false;
  const now = ctx.now;
  const m = now.getHours() * 60 + now.getMinutes();
  if (theme.auto === 'hours') return inRange(m, minutes(theme.from), minutes(theme.to));
  if (theme.auto === 'sleep') return inSleepLead(m, now.getDay(), ctx.schedules || []);
  const sun = ctx.sun || FALLBACK_SUN;
  return !inRange(m, minutes(sun.sunrise), minutes(sun.sunset));
}

/**
 * From SLEEP_LEAD_MIN before a scheduled sleep until its wake-up. A schedule's day is the night that
 * starts that day; wake-up is the same day if later than the sleep time, else the next morning.
 */
function inSleepLead(m, weekday, schedules) {
  for (const s of schedules) {
    if (!s.enabled) continue;
    for (const offset of [-1, 0, 1]) { // the nights starting yesterday, today, tomorrow
      const day = (weekday + offset + 7) % 7;
      if (!s.days.includes(day)) continue;
      const sleep = minutes(s.sleep);
      const wake = minutes(s.wake);
      const start = offset * 1440 + sleep - SLEEP_LEAD_MIN;
      const end = offset * 1440 + (wake > sleep ? wake : wake + 1440);
      if (m >= start && m < end) return true;
    }
  }
  return false;
}

/**
 * The day panel's and clock panel's look (Hybrid's right-hand column, 2026-10-16): theme.panel
 * 'light' or 'dark' keeps it, 'follow' (or missing) uses the page's `pageTheme` ('light'|'dark').
 */
export function panelTheme(theme, pageTheme) {
  return theme && (theme.panel === 'light' || theme.panel === 'dark') ? theme.panel : pageTheme;
}
