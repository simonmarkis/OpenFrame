// Event reminders on the frame (SPEC §11, user 2026-10-16): which reminders are due, and what the
// popup says. Pure; shared by the frame UI (reminders.js), settings, and the Node tests.

/**
 * Bundled chimes (web/sounds/<id>.m4a unless `file` says otherwise; docs/THIRD_PARTY.md); ConfigStore.CHIMES has
 * the same ids. All are CC0.
 */
export const CHIMES = [
  { id: 'bell-1', label: 'Bell 1' },
  { id: 'vibraphone', label: 'Vibraphone' },
  { id: 'confirm-1', label: 'Confirm 1' },
  { id: 'confirm-2', label: 'Confirm 2' },
  { id: 'question', label: 'Question' },
  { id: 'music-box', label: 'Music box', file: 'music-box.wav' },
];

/** The sound file of chime `id` in web/sounds. */
export function chimeFile(id) {
  const c = CHIMES.find((x) => x.id === id);
  return (c && c.file) || `${id}.m4a`;
}

/** Minutes before an event a reminder can be. */
export const REMINDER_MINUTES = [5, 10, 15, 30, 60];

/** How late a reminder may still pop up (the frame checks every 15 s); later ones are skipped, never replayed. */
export const REMINDER_GRACE_MS = 90000;

const MIN = 60000;

/** Identifies one reminder of one occurrence, so it fires once even across reloads. */
export function reminderKey(occ, minutes) {
  return `${occ.calendar}|${occ.uid}|${occ.recurrenceId || ''}|${occ.start}|${minutes}`;
}

/**
 * Reminders due at `nowMs`: for each timed, not yet started occurrence of a calendar with reminders on,
 * each chosen time whose moment (start − minutes) has come within REMINDER_GRACE_MS and isn't in `fired`.
 * All-day events never remind. Returned soonest event first; several per event are possible but only
 * the latest time due is kept (a frame that was busy doesn't chime twice for one event).
 * @param {object[]} occurrences calendar-core occurrences tagged with `calendar`
 * @param {(id: string) => ({ reminders?: { enabled: boolean, minutes: number[] } } | undefined)} calendarById
 * @param {Set<string>|{ has(k: string): boolean }} fired
 */
export function dueReminders(occurrences, calendarById, nowMs, fired) {
  const out = new Map();
  for (const occ of occurrences) {
    if (occ.allDay || occ.start <= nowMs) continue;
    const r = (calendarById(occ.calendar) || {}).reminders;
    if (!r || !r.enabled) continue;
    for (const m of r.minutes || []) {
      const at = occ.start - m * MIN;
      if (at > nowMs || nowMs - at > REMINDER_GRACE_MS) continue;
      const key = reminderKey(occ, m);
      if (fired.has(key)) continue;
      const id = reminderKey(occ, 0);
      const prev = out.get(id);
      if (!prev || m < prev.minutes) out.set(id, { key, occ, minutes: m, keys: prev ? [...prev.keys, key] : [key] });
      else prev.keys.push(key);
    }
  }
  return [...out.values()].sort((a, b) => a.occ.start - b.occ.start);
}

/** "In 10 min", "In 1 hour", "In 1 h 5 min", "Starting now" (under a minute). */
export function startsIn(occ, nowMs) {
  const left = occ.start - nowMs;
  if (left < MIN) return 'Starting now';
  const min = Math.round(left / MIN);
  if (min < 60) return `In ${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `In ${h} h ${m} min` : `In ${h} hour${h > 1 ? 's' : ''}`;
}

/**
 * The popup's place line: the location's first line, or for a link only the site ("zoom.us"), so a
 * meeting link's password never shows across the room.
 */
export function meetingPlace(location) {
  const first = String(location || '').split('\n')[0].trim();
  const m = first.match(/^https?:\/\/([^/?#\s]+)/i);
  if (!m) return first;
  return m[1].toLowerCase().split('.').slice(-2).join('.');
}

/** Keeps only fired keys whose event started less than a day ago (localStorage stays small). */
export function pruneFired(keys, nowMs) {
  return keys.filter((k) => Number(k.split('|')[3]) > nowMs - 86400000);
}
