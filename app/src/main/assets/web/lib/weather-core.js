// Weather display logic (SPEC §12): WMO codes → icon/label, °C → display units, and what to show
// from a cached Open-Meteo forecast. Pure; shared by the clock widget and the Node tests (tests/layout/).

/** Current conditions older than this are not shown as "now"; today's forecast is used instead. */
export const CURRENT_MAX_AGE_MS = 3 * 3600000;

// WMO weather interpretation codes (Open-Meteo docs).
const WMO = new Map([
  [0, ['clear', 'Clear']],
  [1, ['partly', 'Mostly clear']],
  [2, ['partly', 'Partly cloudy']],
  [3, ['cloudy', 'Cloudy']],
  [45, ['fog', 'Fog']], [48, ['fog', 'Freezing fog']],
  [51, ['drizzle', 'Light drizzle']], [53, ['drizzle', 'Drizzle']], [55, ['drizzle', 'Heavy drizzle']],
  [56, ['sleet', 'Freezing drizzle']], [57, ['sleet', 'Freezing drizzle']],
  [61, ['rain', 'Light rain']], [63, ['rain', 'Rain']], [65, ['rain', 'Heavy rain']],
  [66, ['sleet', 'Freezing rain']], [67, ['sleet', 'Freezing rain']],
  [71, ['snow', 'Light snow']], [73, ['snow', 'Snow']], [75, ['snow', 'Heavy snow']], [77, ['snow', 'Snow grains']],
  [80, ['rain', 'Showers']], [81, ['rain', 'Showers']], [82, ['rain', 'Heavy showers']],
  [85, ['snow', 'Snow showers']], [86, ['snow', 'Snow showers']],
  [95, ['thunder', 'Thunderstorm']], [96, ['thunder', 'Thunderstorm, hail']], [99, ['thunder', 'Thunderstorm, hail']],
]);

/** { icon, label } for a WMO code; clear/partly get day or night variants. */
export function wmoInfo(code, isDay = true) {
  const [kind, label] = WMO.get(code) || ['cloudy', ''];
  if (kind === 'clear' || kind === 'partly') return { icon: `${kind}-${isDay ? 'day' : 'night'}`, label };
  return { icon: kind, label };
}

/** Rounded temperature in the display units ('fahrenheit' | 'celsius'); null stays null. */
export function displayTemp(celsius, units) {
  if (typeof celsius !== 'number' || !Number.isFinite(celsius)) return null;
  const v = units === 'celsius' ? celsius : celsius * 9 / 5 + 32;
  const r = Math.round(v);
  return r === 0 ? 0 : r; // no "-0°"
}

/** 'YYYY-MM-DD' of `ms` in `tz` (falls back to the local zone if tz is missing or unknown). */
export function localDay(ms, tz) {
  const opts = { year: 'numeric', month: '2-digit', day: '2-digit' };
  let f;
  try { f = new Intl.DateTimeFormat('en-CA', { ...opts, timeZone: tz || undefined }); }
  catch (e) { f = new Intl.DateTimeFormat('en-CA', opts); }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * What the widget shows, from a /api/weather response.
 * @returns null (nothing to show) or { icon, label, temp|null, feelsLike|null, high|null, low|null, precip|null, current: boolean }
 *   `current` false = cached "now" is too old, so it's today's forecast only (temp null).
 */
export function summarize(weather, now = Date.now()) {
  const f = weather && weather.forecast;
  if (!f || !f.daily || !Array.isArray(f.daily.time)) return null;
  const units = weather.units;
  const i = f.daily.time.indexOf(localDay(now, f.timezone));
  const day = i < 0 ? null : {
    code: f.daily.weather_code?.[i],
    high: displayTemp(f.daily.temperature_2m_max?.[i], units),
    low: displayTemp(f.daily.temperature_2m_min?.[i], units),
    precip: f.daily.precipitation_probability_max?.[i] ?? null,
  };
  const fresh = f.current && weather.lastSuccessAt && now - weather.lastSuccessAt <= CURRENT_MAX_AGE_MS;
  if (fresh) {
    const { icon, label } = wmoInfo(f.current.weather_code, f.current.is_day !== 0);
    return { icon, label, temp: displayTemp(f.current.temperature_2m, units),
      feelsLike: displayTemp(f.current.apparent_temperature, units),
      high: day?.high ?? null, low: day?.low ?? null, precip: day?.precip ?? null, current: true };
  }
  if (!day || day.code === undefined) return null; // cache older than the 7-day forecast
  const { icon, label } = wmoInfo(day.code, true);
  return { icon, label, temp: null, feelsLike: null, high: day.high, low: day.low, precip: day.precip, current: false };
}

/** Today's sunrise and sunset ('HH:MM', forecast time zone) from the cached forecast, or null. */
export function sunTimes(weather, now = Date.now()) {
  const f = weather && weather.forecast;
  if (!f || !f.daily || !Array.isArray(f.daily.time)) return null;
  const i = f.daily.time.indexOf(localDay(now, f.timezone));
  const rise = i < 0 ? null : f.daily.sunrise?.[i];
  const set = i < 0 ? null : f.daily.sunset?.[i];
  if (typeof rise !== 'string' || typeof set !== 'string') return null;
  return { sunrise: rise.slice(11, 16), sunset: set.slice(11, 16) };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The next `days` days after today from the cached forecast (SPEC §8, Phase 11):
 * [{ day: 'Thu', icon, label, high, low }], fewer when the cache runs out.
 */
export function nextDays(weather, days, now = Date.now()) {
  const f = weather && weather.forecast;
  if (!days || !f || !f.daily || !Array.isArray(f.daily.time)) return [];
  const today = localDay(now, f.timezone);
  const out = [];
  f.daily.time.forEach((t, i) => {
    if (t <= today || out.length >= days) return;
    const [y, m, d] = t.split('-').map(Number);
    const { icon, label } = wmoInfo(f.daily.weather_code?.[i], true);
    out.push({
      day: WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()], icon, label,
      high: displayTemp(f.daily.temperature_2m_max?.[i], weather.units),
      low: displayTemp(f.daily.temperature_2m_min?.[i], weather.units),
    });
  });
  return out;
}

/**
 * Whether to show today's high/low (`clock.weatherShow`): when switched on, or in place of the current
 * temperature when that is wanted but too old (offline for hours), so the widget never shows a bare icon.
 */
export function showHighLow(summary, show) {
  if (!summary) return false;
  return show.highLow || (show.current && summary.temp === null);
}
