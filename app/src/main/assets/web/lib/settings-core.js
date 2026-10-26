// Pure helpers for the settings page (SPEC §16): labels, durations, colors, place names, sleep times.
// No DOM, so the Node tests can import it.

/** Google Calendar's event colors, the standard palette in the calendar color picker. */
export const PALETTE = [
  { name: 'Tomato', hex: '#d50000' }, { name: 'Flamingo', hex: '#e67c73' },
  { name: 'Tangerine', hex: '#f4511e' }, { name: 'Banana', hex: '#f6bf26' },
  { name: 'Sage', hex: '#33b679' }, { name: 'Basil', hex: '#0b8043' },
  { name: 'Peacock', hex: '#039be5' }, { name: 'Blueberry', hex: '#3f51b5' },
  { name: 'Lavender', hex: '#7986cb' }, { name: 'Grape', hex: '#8e24aa' },
  { name: 'Graphite', hex: '#616161' }, { name: 'Cocoa', hex: '#795548' },
];

/** Background colors for fitted photos: dark neutrals first. */
/** Text colors offered for the text style (besides Automatic and a custom color). */
export const TEXT_PALETTE = ['#ffffff', '#e8eaed', '#fff3c4', '#fdd663', '#aecbfa', '#a8dab5', '#f6aea9', '#202124'];

export const BACKGROUND_PALETTE = ['#000000', '#1c1c1c', '#333333', '#5f6368', '#ffffff', '#0d1b2a', '#1b2a1b', '#2a1b1b'];

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const SLIDE_INTERVALS = [10, 15, 20, 30, 45, 60, 120, 300, 600, 1800, 3600, 10800, 21600, 86400];
export const INACTIVITY_OPTIONS = [30, 60, 120, 300, 600, 1800, 3600];
export const SYNC_OPTIONS = [5, 10, 15, 30, 60, 120, 360, 720, 1440];
export const TRANSITION_OPTIONS = [0, 500, 1000, 1500, 2000];
export const WOKEN_OPTIONS = [1, 2, 5, 10, 15, 30, 60]; // minutes
export const MAX_SCHEDULES = 10;
/** A new sleep schedule: the user's Frameo schedule (SPEC §18). */
export const DEFAULT_SCHEDULE = { enabled: true, sleep: '21:30', wake: '07:00', days: [0, 1, 2, 3, 4, 5, 6] };

/** Config section → settings tab name, for "what changed" in the snapshot list. */
const SECTION_NAMES = {
  slideshow: 'Photos', media: 'Photos', layout: 'Layout', clock: 'Clock and weather',
  weather: 'Clock and weather', calendar: 'Calendar', calendars: 'Calendar',
  display: 'Display and sleep', sleep: 'Display and sleep', sound: 'Sound',
};

export function sectionNames(changed) {
  const out = [];
  for (const k of changed || []) {
    const name = SECTION_NAMES[k] || k;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** A video's length: 21302 → "0:21", 95000 → "1:35", 3725000 → "1:02:05"; "" if unknown. */
export function clipLength(ms) {
  if (!(ms > 0)) return '';
  const s = Math.round(ms / 1000);
  const two = (n) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

/** 30 → "30 seconds", 120 → "2 minutes", 5400 → "1.5 hours", 86400 → "1 day". */
export function formatDuration(sec) {
  const round1 = (x) => Math.round(x * 10) / 10;
  if (sec < 60) return plural(sec, 'second');
  if (sec < 3600) return plural(round1(sec / 60), 'minute');
  if (sec < 86400) return plural(round1(sec / 3600), 'hour');
  return plural(round1(sec / 86400), 'day');
}

/** The option list, with the current value added (sorted) if it isn't one of the choices. */
export function withCurrent(options, current) {
  return options.includes(current) ? options.slice() : [...options, current].sort((a, b) => a - b);
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function agoText(ms, now = Date.now()) {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return plural(Math.floor(s / 86400), 'day') + ' ago';
}

/** One line under a calendar's name. */
export function feedStatusText(cal, now = Date.now()) {
  if (!cal.enabled) return 'Turned off';
  if (!cal.hasUrl) return 'No link: replace the link to sync';
  const busy = cal.busy ? 'Busy only · ' : '';
  if (cal.status === 'error') return `${busy}Sync failed: ${cal.error || cal.errorKind || 'unknown error'}`;
  if (!cal.lastSuccessAt) return `${busy}Not synced yet`;
  return `${busy}Synced ${agoText(cal.lastSuccessAt, now)}`;
}

/** 1536 → "1.5 KB", bytes in powers of 1024. */
export function formatBytes(n) {
  if (n == null || !isFinite(n)) return '–';
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return i === 0 ? `${v} bytes` : `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

// ---- sleep times (SPEC §18) ----

/** "21:30" → "9:30 PM", or "21:30" on a 24-hour clock. */
export function formatHm(hm, hour12 = true) {
  const [h, m] = hm.split(':').map(Number);
  const mm = String(m).padStart(2, '0');
  if (!hour12) return `${String(h).padStart(2, '0')}:${mm}`;
  return `${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Hours (0–23) and minutes → "HH:MM". */
export const toHm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Schedule days (0 = Sunday) → "Every day", "Weekdays", "Weekends", "No days", or "Mon, Wed, Fri". */
export function daysSummary(days, firstDay = 0) {
  const set = new Set(days);
  if (set.size === 7) return 'Every day';
  if (set.size === 0) return 'No days';
  const weekdays = [1, 2, 3, 4, 5];
  if (set.size === 5 && weekdays.every((d) => set.has(d))) return 'Weekdays';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'Weekends';
  return [0, 1, 2, 3, 4, 5, 6].map((i) => (i + firstDay) % 7).filter((d) => set.has(d)).map((d) => DAY_SHORT[d]).join(', ');
}

/** A moment as "today at 9:30 PM", "tomorrow at 7:00 AM", or "Saturday at 8:00 AM" in the given zone. */
export function dayTimeText(ms, now, timeZone, hour12 = true) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12 })
    .format(ms).replace(/\s/g, ' ');
  const d = day.format(ms);
  if (d === day.format(now)) return `today at ${time}`;
  if (d === day.format(now + 86400000)) return `tomorrow at ${time}`;
  return `${new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(ms)} at ${time}`;
}

// ---- colors ----

export function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

export function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export const isHexColor = (s) => /^#[0-9a-fA-F]{6}$/.test(s);


// ---- places (Open-Meteo geocoding results) ----

const US_STATES = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO',
  Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY',
  Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH',
  'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND',
  Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
};

/** Short name saved as weather.place: "Seattle, WA" in the US, else "Paris, France". */
export function placeLabel(r) {
  if (r.countryCode === 'US' && US_STATES[r.admin1]) return `${r.name}, ${US_STATES[r.admin1]}`;
  return [r.name, r.country || r.admin1].filter(Boolean).join(', ');
}

/** Full line for the search results: "Seattle, Washington, United States". */
export function placeDetail(r) {
  const parts = [r.name];
  if (r.admin1 && r.admin1 !== r.name) parts.push(r.admin1);
  if (r.country) parts.push(r.country);
  return parts.join(', ');
}
