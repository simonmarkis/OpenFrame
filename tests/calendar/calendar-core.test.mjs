// ICS parsing and expansion tests (SPEC §23). Synthetic fixtures only — never real feeds.
// Run: node --test tests/calendar/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseFeed, expandFeed, occurrencesOnDay, timeKind, nextEventDay, dayBounds, dayKey, addDays, wallclockToEpoch,
} from '../../app/src/main/assets/web/lib/calendar-core.js';

const TZ = 'America/Los_Angeles';
const FROM = Date.UTC(2026, 7, 1);   // 2026-08-01
const TO = Date.UTC(2027, 3, 1);     // 2027-04-01

function load(name) {
  const text = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
  const feed = parseFeed(text);
  return { feed, occ: expandFeed(feed, FROM, TO, TZ) };
}

const titles = (occ, day) => occurrencesOnDay(occ, day, TZ).map((o) => o.title);
const iso = (ms) => new Date(ms).toISOString().replace('.000', '');
const localHHMM = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));

// ---- helpers ----

test('day bounds handle DST (25 h in fall, 23 h in spring)', () => {
  const [a, b] = dayBounds('2026-11-01', TZ);
  assert.equal((b - a) / 3600000, 25);
  const [c, d] = dayBounds('2027-03-14', TZ);
  assert.equal((d - c) / 3600000, 23);
  assert.equal(iso(a), '2026-11-01T07:00:00Z');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(dayKey(Date.UTC(2026, 9, 16, 6, 59), TZ), '2026-10-15');
});

test('wall-clock conversion right around DST transitions (offset cache)', () => {
  // Fall back: 2026-11-01 02:00 PDT -> 01:00 PST at 09:00Z.
  assert.equal(iso(wallclockToEpoch(2026, 11, 1, 0, 30, 0, TZ)), '2026-11-01T07:30:00Z');
  assert.equal(iso(wallclockToEpoch(2026, 11, 1, 3, 0, 0, TZ)), '2026-11-01T11:00:00Z');
  assert.equal(localHHMM(Date.UTC(2026, 10, 1, 8, 59)), '01:59'); // PDT
  assert.equal(localHHMM(Date.UTC(2026, 10, 1, 9, 0)), '01:00');  // PST
  // Spring forward: 2027-03-14 02:00 PST -> 03:00 PDT at 10:00Z.
  assert.equal(iso(wallclockToEpoch(2027, 3, 14, 1, 59, 0, TZ)), '2027-03-14T09:59:00Z');
  assert.equal(iso(wallclockToEpoch(2027, 3, 14, 3, 0, 0, TZ)), '2027-03-14T10:00:00Z');
  assert.equal(dayKey(Date.UTC(2027, 2, 14, 7, 59), TZ), '2027-03-13');
  assert.equal(dayKey(Date.UTC(2027, 2, 14, 8, 0), TZ), '2027-03-14');
  // A half-hour zone, to make sure buckets don't assume whole hours.
  assert.equal(iso(wallclockToEpoch(2026, 10, 15, 9, 0, 0, 'Asia/Kolkata')), '2026-10-15T03:30:00Z');
});

// ---- recurrence ----

test('weekly recurrence with EXDATE', () => {
  const { occ } = load('recurring.ics');
  assert.deepEqual(titles(occ, '2026-10-06').filter((t) => t === 'Swim practice'), ['Swim practice']);
  assert.ok(!titles(occ, '2026-10-13').includes('Swim practice'), 'EXDATE removes Oct 13');
  const oct20 = occurrencesOnDay(occ, '2026-10-20', TZ).find((o) => o.title === 'Swim practice');
  assert.equal(iso(oct20.start), '2026-10-21T00:00:00Z'); // 17:00 PDT
  const nov3 = occurrencesOnDay(occ, '2026-11-03', TZ).find((o) => o.title === 'Swim practice');
  assert.equal(iso(nov3.start), '2026-11-04T01:00:00Z');  // 17:00 PST
  assert.equal(oct20.location, 'Community pool');
});

test('monthly BYDAY=2TH recurrence', () => {
  const { occ } = load('recurring.ics');
  const days = occ.filter((o) => o.title === 'Book club').map((o) => dayKey(o.start, TZ));
  assert.deepEqual(days.filter((d) => d >= '2026-09-01' && d < '2026-12-01'), ['2026-09-10', '2026-10-08', '2026-11-12']);
});

test('RECURRENCE-ID overrides: moved time, cancelled instance, moved to another day', () => {
  const { occ } = load('recurring.ics');
  const standups = (day) => occurrencesOnDay(occ, day, TZ).filter((o) => o.title.startsWith('Standup'));
  assert.deepEqual(standups('2026-10-05').map((o) => localHHMM(o.start)), ['09:00']);
  const oct12 = standups('2026-10-12');
  assert.equal(oct12.length, 1, 'override replaces the original instance');
  assert.equal(oct12[0].title, 'Standup (moved)');
  assert.equal(localHHMM(oct12[0].start), '10:30');
  assert.equal(standups('2026-10-19').length, 0, 'STATUS:CANCELLED override hides the instance');
  assert.equal(standups('2026-10-26').length, 0, 'instance moved away from its original day');
  assert.deepEqual(standups('2026-10-27').map((o) => o.title), ['Standup (moved to Tuesday)']);
  assert.deepEqual(standups('2026-11-02').map((o) => localHHMM(o.start)), ['09:00'], '09:00 local after DST ends');
});

test('COUNT, ended UNTIL series, cancelled single event, biweekly all-day', () => {
  const { occ } = load('recurring.ics');
  const vit = occ.filter((o) => o.title === 'Vitamins').map((o) => dayKey(o.start, TZ));
  assert.deepEqual(vit, ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
  assert.equal(occ.filter((o) => o.title === 'Old series').length, 0);
  assert.equal(occ.filter((o) => o.title === 'Cancelled dinner').length, 0);
  const trash = occ.filter((o) => o.title === 'Trash day').map((o) => o.startDay);
  assert.deepEqual(trash.filter((d) => d < '2026-11-01'), ['2026-10-02', '2026-10-16', '2026-10-30']);
});

test('day view ordering', () => {
  const { occ } = load('recurring.ics');
  assert.deepEqual(titles(occ, '2026-10-12'), ['Vitamins', 'Standup (moved)']);
  assert.deepEqual(titles(occ, '2026-10-16'), ['Trash day', 'Vitamins']);
});

// ---- all-day, multi-day, zones ----

test('all-day: single, multi-day (exclusive DTEND), and no DTEND', () => {
  const { occ } = load('allday-timed.ics');
  assert.deepEqual(titles(occ, '2026-10-14')[0], 'Teacher planning day');
  assert.ok(!titles(occ, '2026-10-15').includes('Teacher planning day'));
  for (const d of ['2026-10-20', '2026-10-21', '2026-10-22']) assert.ok(titles(occ, d).includes('Grandma visiting'), d);
  assert.ok(!titles(occ, '2026-10-23').includes('Grandma visiting'));
  assert.ok(titles(occ, '2026-10-16').includes('Library books due'));
  assert.ok(!titles(occ, '2026-10-17').includes('Library books due'));
  assert.equal(timeKind(occ.find((o) => o.title === 'Grandma visiting'), '2026-10-21', TZ), 'allDay');
});

test('timed events crossing midnight and spanning days', () => {
  const { occ } = load('allday-timed.ics');
  const flight = occ.find((o) => o.title === 'Late flight');
  assert.ok(titles(occ, '2026-10-16').includes('Late flight'));
  assert.ok(titles(occ, '2026-10-17').includes('Late flight'));
  assert.equal(timeKind(flight, '2026-10-16', TZ), 'starts');
  assert.equal(timeKind(flight, '2026-10-17', TZ), 'until');
  const conf = occ.find((o) => o.title === 'Conference');
  assert.deepEqual(['2026-10-26', '2026-10-27', '2026-10-28'].map((d) => timeKind(conf, d, TZ)), ['starts', 'through', 'until']);
  assert.ok(!titles(occ, '2026-10-29').includes('Conference'));
});

test('UTC, floating, missing VTIMEZONE (Intl fallback), DURATION, zero-length', () => {
  const { occ } = load('allday-timed.ics');
  assert.deepEqual(titles(occ, '2026-10-15'), ['Floating breakfast', 'Call with Berlin', 'Reminder: call plumber', 'Dentist']);
  const by = (t) => occ.find((o) => o.title === t);
  assert.equal(localHHMM(by('Call with Berlin').start), '11:00');
  assert.equal(iso(by('Floating breakfast').start), '2026-10-15T15:00:00Z'); // 08:00 in the display zone
  assert.equal(iso(by('Tokyo office hours').start), '2026-10-15T00:00:00Z'); // 09:00 JST
  assert.ok(titles(occ, '2026-10-14').includes('Tokyo office hours'), '17:00 PDT the day before');
  const dentist = by('Dentist');
  assert.equal((dentist.end - dentist.start) / 60000, 45);
  assert.equal(dentist.description, 'Bring insurance card.<br>Arrive 10 min early.');
  const zero = by('Reminder: call plumber');
  assert.equal(zero.start, zero.end);
});

test('floating times follow the display zone', () => {
  const text = readFileSync(fileURLToPath(new URL('./fixtures/allday-timed.ics', import.meta.url)), 'utf8');
  const occ = expandFeed(parseFeed(text), FROM, TO, 'Europe/London');
  assert.equal(iso(occ.find((o) => o.title === 'Floating breakfast').start), '2026-10-15T07:00:00Z'); // 08:00 BST
});

test('DST: weekly local time is stable across fall-back and spring-forward', () => {
  const { occ } = load('dst-multitz.ics');
  const pancakes = occ.filter((o) => o.title === 'Sunday pancakes');
  assert.deepEqual(pancakes.map((o) => iso(o.start)), ['2026-10-25T17:00:00Z', '2026-11-01T18:00:00Z', '2026-11-08T18:00:00Z']);
  assert.deepEqual(pancakes.map((o) => localHHMM(o.start)), ['10:00', '10:00', '10:00']);
  const soccer = occ.filter((o) => o.title === 'Saturday soccer');
  assert.deepEqual(soccer.map((o) => iso(o.start)), ['2027-03-13T17:30:00Z', '2027-03-20T16:30:00Z']);
});

test('multiple VTIMEZONEs: Berlin DST change shifts the LA time for one week', () => {
  const { occ } = load('dst-multitz.ics');
  const sync = occ.filter((o) => o.title === 'Berlin team sync');
  assert.deepEqual(sync.map((o) => iso(o.start)), ['2026-10-19T07:00:00Z', '2026-10-26T08:00:00Z', '2026-11-02T08:00:00Z']);
  assert.deepEqual(sync.map((o) => localHHMM(o.start)), ['00:00', '01:00', '00:00']);
  assert.equal(localHHMM(occ.find((o) => o.title === 'Call with NYC').start), '06:00');
});

test('next event day skips empty and cancelled days', () => {
  const { feed } = load('recurring.ics');
  assert.equal(nextEventDay([feed], '2026-10-17', TZ), '2026-10-20');
  assert.equal(nextEventDay([feed], '2026-10-11', TZ), '2026-10-12');
});

// ---- fast-forward must not change results ----

const key = (o) => `${o.uid}|${o.recurrenceId}|${o.title}|${o.start}|${o.end}`;

test('fast-forwarded expansion equals full iteration for every fixture and window', () => {
  const windows = [
    ['2026-10-05', 21], ['2026-09-28', 52], ['2026-12-20', 30], ['2027-03-01', 31], ['2025-01-01', 14],
  ];
  for (const name of ['recurring.ics', 'allday-timed.ics', 'dst-multitz.ics', 'old-series.ics']) {
    const text = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
    const feed = parseFeed(text);
    for (const [day, len] of windows) {
      const from = dayBounds(day, TZ)[0];
      const to = dayBounds(addDays(day, len), TZ)[0];
      const fast = expandFeed(feed, from, to, TZ).map(key).sort();
      const slow = expandFeed(feed, from, to, TZ, { fastForward: false }).map(key).sort();
      assert.deepEqual(fast, slow, `${name} window ${day}+${len}`);
    }
  }
});

test('long-running series land on the right days', () => {
  const { occ } = load('old-series.ics');
  const on = (t) => occ.filter((o) => o.title === t).map((o) => dayKey(o.start, TZ));
  const inOct = (days) => days.filter((d) => d >= '2026-10-12' && d <= '2026-10-25');
  assert.deepEqual(inOct(on('Piano lesson')), ['2026-10-12', '2026-10-21']); // Oct 14 EXDATE, Oct 19 overridden
  assert.deepEqual(inOct(on('Piano lesson (recital)')), ['2026-10-19']);
  assert.deepEqual(on('HOA meeting').filter((d) => d.startsWith('2026-1')), ['2026-10-08', '2026-11-12', '2026-12-10']);
  assert.ok(on("Mom's birthday").includes('2026-10-20'));
  assert.deepEqual(inOct(on('Physical therapy')), ['2026-10-15', '2026-10-22']);
  assert.equal(on('Month-end report').filter((d) => d.startsWith('2026-1')).join(), '2026-10-31,2026-11-30,2026-12-31');
});

test('expansion of long-running series is fast', () => {
  const { feed } = load('old-series.ics');
  const from = dayBounds('2026-10-06', TZ)[0];
  const to = dayBounds('2026-11-27', TZ)[0];
  const t0 = performance.now();
  expandFeed(feed, from, to, TZ, { fastForward: false });
  const slow = performance.now() - t0;
  const t1 = performance.now();
  expandFeed(feed, from, to, TZ);
  const fast = performance.now() - t1;
  console.log(`  old-series 52-day window: full iteration ${slow.toFixed(1)} ms, fast-forward ${fast.toFixed(1)} ms`);
  assert.ok(fast < slow / 3, `fast-forward should be much faster (${fast.toFixed(1)} vs ${slow.toFixed(1)} ms)`);
});

test('garbage input throws (reported, never silently empty)', () => {
  assert.throws(() => parseFeed('<html>Not found</html>'));
});
