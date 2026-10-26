// Event reminders: which are due, what the popup says (SPEC §11). Synthetic events only.
// Run: node --test tests/calendar/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  dueReminders, startsIn, pruneFired, reminderKey, meetingPlace, REMINDER_GRACE_MS, CHIMES, chimeFile,
} from '../../app/src/main/assets/web/lib/reminder-core.js';

const MIN = 60000;
const T = Date.UTC(2026, 9, 16, 20, 0); // 1:00 PM Pacific
const occ = (id, startMin, extra = {}) => ({
  calendar: 'c1', uid: id, recurrenceId: null, title: id, allDay: false, start: T + startMin * MIN, end: T + (startMin + 30) * MIN, ...extra,
});
const cals = { c1: { reminders: { enabled: true, minutes: [5, 15] } }, c2: { reminders: { enabled: false, minutes: [10] } } };
const byId = (id) => cals[id];
const due = (list, now, fired = new Set()) => dueReminders(list, byId, now, fired).map((d) => `${d.occ.uid}:${d.minutes}`);

test('a reminder is due from its moment until the grace period ends', () => {
  const e = [occ('a', 0)];
  assert.deepEqual(due(e, T - 15 * MIN - 1), []);
  assert.deepEqual(due(e, T - 15 * MIN), ['a:15']);
  assert.deepEqual(due(e, T - 15 * MIN + REMINDER_GRACE_MS), ['a:15']);
  assert.deepEqual(due(e, T - 15 * MIN + REMINDER_GRACE_MS + 1), []); // missed (asleep): never replayed
  assert.deepEqual(due(e, T - 5 * MIN), ['a:5']);
});

test('fired reminders, started events, all-day events, and calendars with reminders off never pop up', () => {
  const now = T - 5 * MIN;
  assert.deepEqual(due([occ('a', 0)], now, new Set([reminderKey(occ('a', 0), 5)])), []);
  assert.deepEqual(due([occ('a', -1)], now + 10 * MIN), []);
  assert.deepEqual(due([occ('a', 0, { allDay: true })], now), []);
  assert.deepEqual(due([occ('a', 0, { calendar: 'c2' })], T - 10 * MIN), []);
  assert.deepEqual(due([occ('a', 0, { calendar: 'unknown' })], now), []);
});

test('two events at once come back together, soonest first; one event chimes once when two times are due', () => {
  const now = T - 5 * MIN;
  assert.deepEqual(due([occ('b', 1), occ('a', 0)], now - 0), ['a:5']); // b's 5-min moment is still ahead
  assert.deepEqual(due([occ('b', 0), occ('a', 0)], now).sort(), ['a:5', 'b:5']);
  // 15 and 5 minutes both due (a 15-minute event added late): one entry, both keys marked.
  const late = dueReminders([occ('a', 0)], (id) => ({ reminders: { enabled: true, minutes: [5, 15] } }), T - 5 * MIN + 1000, new Set());
  assert.equal(late.length, 1);
  assert.equal(late[0].minutes, 5);
});

test('popup wording', () => {
  assert.equal(startsIn(occ('a', 0), T - 10 * MIN), 'In 10 min');
  assert.equal(startsIn(occ('a', 0), T - 30 * 1000), 'Starting now');
  assert.equal(startsIn(occ('a', 0), T - 60 * MIN), 'In 1 hour');
  assert.equal(startsIn(occ('a', 0), T - 65 * MIN), 'In 1 h 5 min');
});

test('a meeting link shows only its site; other places their first line', () => {
  assert.equal(meetingPlace('https://example-co.zoom.us/j/123?pwd=secret'), 'zoom.us');
  assert.equal(meetingPlace('https://meet.google.com/abc-defg-hij'), 'google.com');
  assert.equal(meetingPlace('Room 4\nSecond floor'), 'Room 4');
  assert.equal(meetingPlace(''), '');
});

test('remembered reminders older than a day are dropped', () => {
  const keys = [reminderKey(occ('old', -25 * 60), 5), reminderKey(occ('new', 0), 5)];
  assert.deepEqual(pruneFired(keys, T), [keys[1]]);
});

test('the chime list matches the bundled files and the frame\'s list', () => {
  const kotlin = readFileSync(fileURLToPath(new URL('../../app/src/main/java/app/openframe/ConfigStore.kt', import.meta.url)), 'utf8');
  const listed = kotlin.match(/val CHIMES = listOf\(([^)]*)\)/)[1].match(/"([^"]+)"/g).map((s) => s.slice(1, -1));
  assert.deepEqual(CHIMES.map((c) => c.id), listed);
  for (const c of CHIMES) {
    readFileSync(fileURLToPath(new URL(`../../app/src/main/assets/web/sounds/${chimeFile(c.id)}`, import.meta.url)));
  }
});
