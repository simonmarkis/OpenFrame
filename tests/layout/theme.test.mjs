// Dark mode: when Automatic turns dark (SPEC §9, Phase 11c).
// Run: node --test "tests/layout/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDark, panelTheme } from '../../app/src/main/assets/web/lib/theme-core.js';

const auto = (kind, extra = {}) => ({ mode: 'auto', auto: kind, from: '19:00', to: '07:00', ...extra });
// Wed Oct 14, 2026 at h:m local time (getDay() = 3).
const at = (h, m = 0, day = 14) => new Date(2026, 9, day, h, m);
const NIGHTLY = [{ enabled: true, sleep: '21:30', wake: '07:00', days: [0, 1, 2, 3, 4, 5, 6] }];

test('Light and Dark ignore the time', () => {
  assert.equal(isDark({ mode: 'dark' }, { now: at(12) }), true);
  assert.equal(isDark({ mode: 'light' }, { now: at(23) }), false);
});

test('sunset to sunrise, with 7 PM–7 AM when there is no weather', () => {
  const sun = { sunrise: '07:21', sunset: '18:15' };
  assert.equal(isDark(auto('sun'), { now: at(12), sun }), false);
  assert.equal(isDark(auto('sun'), { now: at(18, 15), sun }), true);
  assert.equal(isDark(auto('sun'), { now: at(7, 20), sun }), true);
  assert.equal(isDark(auto('sun'), { now: at(7, 21), sun }), false);
  assert.equal(isDark(auto('sun'), { now: at(18, 30), sun: null }), false);
  assert.equal(isDark(auto('sun'), { now: at(19, 0), sun: null }), true);
});

test('between two times, across midnight or not', () => {
  assert.equal(isDark(auto('hours'), { now: at(23) }), true);
  assert.equal(isDark(auto('hours'), { now: at(6, 59) }), true);
  assert.equal(isDark(auto('hours'), { now: at(7) }), false);
  const day = auto('hours', { from: '13:00', to: '15:00' });
  assert.equal(isDark(day, { now: at(14) }), true);
  assert.equal(isDark(day, { now: at(16) }), false);
});

test('around sleep hours: 2 h before sleep until wake-up', () => {
  assert.equal(isDark(auto('sleep'), { now: at(19, 29), schedules: NIGHTLY }), false);
  assert.equal(isDark(auto('sleep'), { now: at(19, 30), schedules: NIGHTLY }), true);
  assert.equal(isDark(auto('sleep'), { now: at(3), schedules: NIGHTLY }), true);
  assert.equal(isDark(auto('sleep'), { now: at(7), schedules: NIGHTLY }), false);
  assert.equal(isDark(auto('sleep'), { now: at(20), schedules: [{ ...NIGHTLY[0], enabled: false }] }), false);
});

test('around sleep hours: weekdays and sleep times after midnight', () => {
  const weekend = [{ enabled: true, sleep: '23:00', wake: '08:00', days: [5, 6] }]; // Fri, Sat nights
  assert.equal(isDark(auto('sleep'), { now: at(22, 0, 14), schedules: weekend }), false); // Wednesday
  assert.equal(isDark(auto('sleep'), { now: at(22, 0, 16), schedules: weekend }), true); // Friday
  assert.equal(isDark(auto('sleep'), { now: at(7, 0, 17), schedules: weekend }), true); // Saturday morning
  const late = [{ enabled: true, sleep: '00:30', wake: '07:00', days: [4] }]; // the night "starting" Thursday
  assert.equal(isDark(auto('sleep'), { now: at(23, 0, 14), schedules: late }), true); // Wed 23:00 = 1.5 h before
  assert.equal(isDark(auto('sleep'), { now: at(22, 0, 14), schedules: late }), false);
});

test('the calendar and clock panel follow the theme unless set to Light or Dark', () => {
  assert.equal(panelTheme({ mode: 'light', panel: 'follow' }, 'light'), 'light');
  assert.equal(panelTheme({ mode: 'dark', panel: 'follow' }, 'dark'), 'dark');
  assert.equal(panelTheme({ mode: 'dark', panel: 'light' }, 'dark'), 'light');
  assert.equal(panelTheme({ mode: 'light', panel: 'dark' }, 'light'), 'dark');
  assert.equal(panelTheme({ mode: 'auto' }, 'dark'), 'dark'); // older configs without the setting
});
