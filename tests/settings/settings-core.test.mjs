// Settings page helpers (SPEC §16).
// Run: node --test "tests/settings/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PALETTE, sectionNames, formatDuration, shortDuration, withCurrent, agoText, feedStatusText, formatBytes,
  hslToHex, hexToHsl, isHexColor, placeLabel, placeDetail, formatHm, toHm, daysSummary, dayTimeText, clipLength,
} from '../../app/src/main/assets/web/lib/settings-core.js';

test('video lengths read like a player', () => {
  assert.equal(clipLength(21302), '0:21'); // the Shortcut video
  assert.equal(clipLength(3000), '0:03');
  assert.equal(clipLength(95000), '1:35');
  assert.equal(clipLength(3725000), '1:02:05');
  assert.equal(clipLength(null), '');
  assert.equal(clipLength(0), '');
});

test('sleep times read like the clock', () => {
  assert.equal(formatHm('21:30'), '9:30 PM');
  assert.equal(formatHm('07:05'), '7:05 AM');
  assert.equal(formatHm('00:00'), '12:00 AM');
  assert.equal(formatHm('12:15'), '12:15 PM');
  assert.equal(formatHm('07:05', false), '07:05');
  assert.equal(toHm(7, 5), '07:05');
  assert.equal(toHm(21, 30), '21:30');
});

test('schedule days summary', () => {
  assert.equal(daysSummary([0, 1, 2, 3, 4, 5, 6]), 'Every day');
  assert.equal(daysSummary([5, 1, 2, 3, 4]), 'Weekdays');
  assert.equal(daysSummary([6, 0]), 'Weekends');
  assert.equal(daysSummary([]), 'No days');
  assert.equal(daysSummary([5, 1, 3]), 'Mon, Wed, Fri');
  assert.equal(daysSummary([0, 1]), 'Sun, Mon');
  assert.equal(daysSummary([0, 1], 1), 'Mon, Sun'); // weeks starting on Monday
});

test('next sleep and wake times', () => {
  const tz = 'America/Los_Angeles';
  const now = Date.parse('2026-10-13T20:00:00-07:00'); // Tuesday evening
  assert.equal(dayTimeText(Date.parse('2026-10-13T21:30:00-07:00'), now, tz), 'today at 9:30 PM');
  assert.equal(dayTimeText(Date.parse('2026-10-14T07:00:00-07:00'), now, tz), 'tomorrow at 7:00 AM');
  assert.equal(dayTimeText(Date.parse('2026-10-17T08:00:00-07:00'), now, tz), 'Saturday at 8:00 AM');
  assert.equal(dayTimeText(Date.parse('2026-10-14T07:00:00-07:00'), now, tz, false), 'tomorrow at 07:00');
});

test('durations read naturally', () => {
  assert.equal(formatDuration(1), '1 second');
  assert.equal(formatDuration(30), '30 seconds');
  assert.equal(shortDuration(30), '30 sec');
  assert.equal(shortDuration(90), '1.5 min');
  assert.equal(shortDuration(7200), '2 hr');
  assert.equal(formatDuration(60), '1 minute');
  assert.equal(formatDuration(90), '1.5 minutes');
  assert.equal(formatDuration(3600), '1 hour');
  assert.equal(formatDuration(5400), '1.5 hours');
  assert.equal(formatDuration(86400), '1 day');
});

test('an unusual current value is kept in the option list, sorted', () => {
  assert.deepEqual(withCurrent([10, 30, 60], 30), [10, 30, 60]);
  assert.deepEqual(withCurrent([10, 30, 60], 45), [10, 30, 45, 60]);
});

test('snapshot sections map to tab names without duplicates', () => {
  assert.deepEqual(sectionNames(['clock', 'weather', 'layout']), ['Clock and weather', 'Layout']);
  assert.deepEqual(sectionNames(['calendar', 'calendars', 'media', 'slideshow']), ['Calendar', 'Photos']);
  assert.deepEqual(sectionNames([]), []);
});

test('relative times', () => {
  const now = 1_800_000_000_000;
  assert.equal(agoText(0, now), 'never');
  assert.equal(agoText(now - 20_000, now), 'just now');
  assert.equal(agoText(now - 5 * 60_000, now), '5 min ago');
  assert.equal(agoText(now - 3 * 3600_000, now), '3 h ago');
  assert.equal(agoText(now - 2 * 86400_000, now), '2 days ago');
});

test('calendar status line', () => {
  const now = 1_800_000_000_000;
  const base = { enabled: true, hasUrl: true, busy: false, status: 'ok', lastSuccessAt: now - 120_000 };
  assert.equal(feedStatusText(base, now), 'Synced 2 min ago');
  assert.equal(feedStatusText({ ...base, busy: true }, now), 'Busy only · Synced 2 min ago');
  assert.equal(feedStatusText({ ...base, enabled: false }, now), 'Turned off');
  assert.equal(feedStatusText({ ...base, lastSuccessAt: 0, status: 'never_synced' }, now), 'Not synced yet');
  assert.equal(feedStatusText({ ...base, status: 'error', error: 'HTTP 404' }, now), 'Sync failed: HTTP 404');
  assert.match(feedStatusText({ ...base, hasUrl: false }, now), /No link/);
});

test('bytes', () => {
  assert.equal(formatBytes(512), '512 bytes');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(25 * 1024 ** 3), '25 GB');
  assert.equal(formatBytes(null), '–');
});


test('colors: palette and HSL round trip', () => {
  assert.equal(PALETTE.length, 12);
  assert.ok(PALETTE.every((p) => isHexColor(p.hex)));
  assert.equal(hslToHex(0, 100, 50), '#ff0000');
  assert.equal(hslToHex(120, 100, 25), '#008000');
  for (const { hex } of PALETTE) {
    const { h, s, l } = hexToHsl(hex);
    const back = hslToHex(h, s, l);
    // Rounding to whole degrees/percent moves each channel by at most a few steps.
    for (let i = 1; i < 7; i += 2) {
      assert.ok(Math.abs(parseInt(back.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16)) <= 4, `${hex} → ${back}`);
    }
  }
  assert.equal(isHexColor('#12abEF'), true);
  assert.equal(isHexColor('12abef'), false);
});

test('place names: US state abbreviations, else the country', () => {
  const seattle = { name: 'Seattle', admin1: 'Washington', country: 'United States', countryCode: 'US' };
  assert.equal(placeLabel(seattle), 'Seattle, WA');
  assert.equal(placeDetail(seattle), 'Seattle, Washington, United States');
  const paris = { name: 'Paris', admin1: 'Île-de-France', country: 'France', countryCode: 'FR' };
  assert.equal(placeLabel(paris), 'Paris, France');
  const dc = { name: 'Washington', admin1: 'District of Columbia', country: 'United States', countryCode: 'US' };
  assert.equal(placeLabel(dc), 'Washington, DC');
  const noAdmin = { name: 'Monaco', admin1: '', country: 'Monaco', countryCode: 'MC' };
  assert.equal(placeDetail(noAdmin), 'Monaco, Monaco');
});
