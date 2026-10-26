// Declined events (calendar email) and dark mode event colors (SPEC §9, §11). Synthetic data only.
// Run: node --test tests/calendar/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, expandFeed } from '../../app/src/main/assets/web/lib/calendar-core.js';
import { darkEventColors, contrast } from '../../app/src/main/assets/web/lib/colors.js';
import { PALETTE } from '../../app/src/main/assets/web/lib/settings-core.js';

const TZ = 'America/Los_Angeles';
const FROM = Date.UTC(2026, 9, 1);
const TO = Date.UTC(2026, 10, 1);

const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN',
  'BEGIN:VEVENT', 'UID:a@test', 'DTSTART:20261020T160000Z', 'DTEND:20261020T170000Z', 'SUMMARY:Declined by me',
  'ATTENDEE;CN=Other;PARTSTAT=ACCEPTED:mailto:other@example.com',
  'ATTENDEE;CN=Me;PARTSTAT=DECLINED:mailto:Me@Example.com',
  'END:VEVENT',
  'BEGIN:VEVENT', 'UID:b@test', 'DTSTART:20261021T160000Z', 'DTEND:20261021T170000Z', 'SUMMARY:Declined by someone else',
  'ATTENDEE;PARTSTAT=DECLINED:mailto:other@example.com',
  'ATTENDEE;PARTSTAT=ACCEPTED:mailto:me@example.com',
  'END:VEVENT',
  // A weekly series I accepted, with one instance I declined.
  'BEGIN:VEVENT', 'UID:c@test', 'DTSTART:20261005T170000Z', 'DTEND:20261005T173000Z', 'RRULE:FREQ=WEEKLY;COUNT=3',
  'SUMMARY:Weekly', 'ATTENDEE;PARTSTAT=ACCEPTED:mailto:me@example.com', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:c@test', 'RECURRENCE-ID:20261012T170000Z', 'DTSTART:20261012T170000Z', 'DTEND:20261012T173000Z',
  'SUMMARY:Weekly', 'ATTENDEE;PARTSTAT=DECLINED:mailto:me@example.com', 'END:VEVENT',
  'END:VCALENDAR', '',
].join('\r\n');

const declinedTitles = (selfEmail) => expandFeed(parseFeed(ICS), FROM, TO, TZ, { selfEmail })
  .filter((o) => o.declined).map((o) => `${o.title} ${new Date(o.start).toISOString().slice(0, 10)}`).sort();

test('only events the given guest declined are marked (case-insensitive address)', () => {
  assert.deepEqual(declinedTitles('me@example.com'), ['Declined by me 2026-10-20', 'Weekly 2026-10-12']);
});

test('without an email nothing is marked declined', () => {
  assert.deepEqual(declinedTitles(''), []);
});

test('dark mode fills keep dark text readable for every palette color', () => {
  for (const p of PALETTE) {
    const { fill, ink } = darkEventColors(p.hex);
    assert.match(fill, /^#[0-9a-f]{6}$/);
    assert.ok(contrast(fill, ink) >= 4.5, `${p.name}: ${fill} on ${ink} is ${contrast(fill, ink).toFixed(2)}`);
    assert.ok(contrast(fill, '#202124') >= 3, `${p.name}: fill too close to the dark background`);
  }
});

test('dark mode fills work for custom colors (very dark, very light, gray) and bad input', () => {
  for (const hex of ['#000000', '#0a0a40', '#ffffff', '#fff59d', '#808080', 'oops']) {
    const { fill, ink } = darkEventColors(hex);
    assert.ok(contrast(fill, ink) >= 4.5, `${hex}: ${contrast(fill, ink).toFixed(2)}`);
  }
});
