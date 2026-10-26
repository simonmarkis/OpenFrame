// Layout presets and weather display logic (SPEC §8, §12, §14).
// Run: node --test "tests/layout/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESETS, CORNERS, presetPage, arrangementFor, gridBox, anchorBox, validateArrangement,
  layoutPages, homePage, findPage, pageView, customFromPreset, resolveArrangement, validatePages, validateCustomArrangement,
  hasWidget, MAX_PAGES,
} from '../../app/src/main/assets/web/lib/layout-core.js';
import {
  wmoInfo, displayTemp, localDay, summarize, CURRENT_MAX_AGE_MS,
} from '../../app/src/main/assets/web/lib/weather-core.js';

// The frame's CSS viewport (DPR 0.85) and physical screen.
const CSS_W = 1608;
const DEVICE_W = 1366;
const DEVICE_H = 768;

const byId = (arr, id) => arr.widgets.find((w) => w.id === id);

// ---- layout ----

test('every preset × orientation × clock option is a valid arrangement', () => {
  for (const preset of PRESETS) {
    for (const corner of CORNERS) {
      for (const clockVisible of [true, false]) {
        const page = presetPage(preset, { corner, clockVisible });
        for (const portrait of [false, true]) {
          const arr = arrangementFor(page, portrait);
          assert.deepEqual(validateArrangement(arr), [], `${preset} ${corner} clock=${clockVisible} portrait=${portrait}`);
        }
      }
    }
  }
});

test('unknown preset falls back to hybrid', () => {
  assert.equal(presetPage('nope').preset, 'hybrid');
});

test('hybrid landscape: photo is 9/12 wide = 1024×768 device px (4:3), column on the right', () => {
  const arr = presetPage('hybrid').landscape;
  const b = gridBox(byId(arr, 'photo'), arr);
  assert.equal(b.left, 0);
  assert.equal(b.width, 0.75);
  assert.equal(b.height, 1);
  assert.ok(Math.abs(b.width * DEVICE_W - 1024.5) < 0.01);
  assert.ok(Math.abs((b.width * DEVICE_W) / DEVICE_H - 4 / 3) < 0.01);
  assert.equal(b.width * CSS_W, 1206);
  const clock = byId(arr, 'clock');
  const cal = byId(arr, 'calendar');
  assert.equal(clock.style, 'panel');
  assert.equal(clock.x, 9);
  assert.equal(cal.x, 9);
  assert.equal(cal.y, clock.y + clock.h, 'day panel sits right below the clock');
  assert.equal(cal.days, 1);
});

test('hybrid landscape without clock: day panel takes the whole column', () => {
  const arr = presetPage('hybrid', { clockVisible: false }).landscape;
  assert.equal(byId(arr, 'clock'), undefined);
  const cal = byId(arr, 'calendar');
  assert.equal(cal.y, 0);
  assert.equal(cal.h, arr.rows);
});

test('hybrid portrait: photo top 3/4 (3:4 on the 768×1366 screen), 2-day panel below, clock overlaid in the photo corner', () => {
  for (const corner of CORNERS) {
    const arr = presetPage('hybrid', { corner }).portrait;
    const photo = gridBox(byId(arr, 'photo'), arr);
    assert.ok(Math.abs(photo.height - 3 / 4) < 1e-9);
    assert.ok(Math.abs((photo.width * 768) / (photo.height * 1366) - 3 / 4) < 0.001); // 768×1024.5
    const cal = byId(arr, 'calendar');
    assert.equal(cal.days, 2);
    assert.equal(gridBox(cal, arr).top, photo.height);
    const clock = byId(arr, 'clock');
    assert.equal(clock.style, 'overlay');
    // Sharing the bottom-left corner with the offline/warning icons: lifted above them.
    assert.deepEqual(clock.anchor, corner === 'bottom-left' ? { corner, over: 'photo', lift: true } : { corner, over: 'photo' });
    assert.deepEqual(byId(arr, 'status').anchor, { corner: 'bottom-left', over: 'photo' });
    assert.deepEqual(anchorBox(clock, arr), photo);
  }
});

test('pictures: full-screen photo, calendar icon bottom-left, clock in the chosen corner', () => {
  for (const corner of CORNERS) {
    const page = presetPage('pictures', { corner });
    for (const arr of [page.landscape, page.portrait]) {
      assert.deepEqual(gridBox(byId(arr, 'photo'), arr), { left: 0, top: 0, width: 1, height: 1 });
      assert.deepEqual(byId(arr, 'calicon').anchor, { corner: 'bottom-left' });
      const clock = byId(arr, 'clock');
      assert.equal(clock.anchor.corner, corner);
      // Sharing the bottom-left corner (calendar icon, status icons beside it): the clock is lifted.
      assert.equal(Boolean(clock.anchor.lift), corner === 'bottom-left');
      assert.deepEqual(byId(arr, 'status').anchor, { corner: 'bottom-left', beside: true });
      assert.deepEqual(anchorBox(clock, arr), { left: 0, top: 0, width: 1, height: 1 });
      // Overlays are drawn after (above) the photo.
      assert.ok(arr.widgets.indexOf(clock) > arr.widgets.indexOf(byId(arr, 'photo')));
    }
  }
  assert.equal(byId(presetPage('pictures', { clockVisible: false }).landscape, 'clock'), undefined);
});

test('calendar: calendar_full full screen (plus the status icons) in both orientations', () => {
  const page = presetPage('calendar');
  for (const arr of [page.landscape, page.portrait]) {
    assert.deepEqual(arr.widgets.map((w) => w.type), ['calendar_full', 'status']);
    assert.deepEqual(gridBox(byId(arr, 'calendar'), arr), { left: 0, top: 0, width: 1, height: 1 });
  }
});

test('validateArrangement catches overlaps, out-of-bounds, and bad anchors', () => {
  const arr = {
    cols: 12, rows: 12, widgets: [
      { id: 'a', type: 'photo', x: 0, y: 0, w: 8, h: 12 },
      { id: 'b', type: 'calendar_day', x: 7, y: 0, w: 6, h: 12 },
      { id: 'c', type: 'clock_weather', anchor: { corner: 'middle', over: 'zzz' } },
    ],
  };
  const p = validateArrangement(arr).join('\n');
  assert.match(p, /b: outside/);
  assert.match(p, /b overlaps a/);
  assert.match(p, /bad corner/);
  assert.match(p, /missing widget zzz/);
});

// ---- pages (Phase 13) ----

const OPTS = { corner: 'top-right', clockVisible: true, caption: { visible: true, corner: 'bottom-left' } };

test('configs without pages show one built-in page from layout.preset', () => {
  assert.deepEqual(layoutPages({ preset: 'pictures', pages: [], home: '' }), [{ id: 'home', name: 'Pictures only', preset: 'pictures' }]);
  assert.deepEqual(layoutPages({ preset: 'calendar' }), [{ id: 'home', name: 'Calendar', preset: 'calendar' }]);
  assert.equal(layoutPages({ preset: 'nope', pages: [] })[0].preset, 'hybrid');
  assert.equal(homePage({ preset: 'hybrid', pages: [], home: '' }).id, 'home');
});

test('home page: layout.home, else the first; unknown ids fall back to home', () => {
  const layout = { preset: 'hybrid', home: 'b', pages: [{ id: 'a', name: 'A', preset: 'pictures' }, { id: 'b', name: 'B', preset: 'calendar' }] };
  assert.equal(homePage(layout).id, 'b');
  assert.equal(homePage({ ...layout, home: '' }).id, 'a');
  assert.equal(findPage(layout, 'a').id, 'a');
  assert.equal(findPage(layout, 'gone').id, 'b');
  assert.equal(findPage(layout, null).id, 'b');
});

test('a built-in page renders exactly like its preset, with its own id and name', () => {
  for (const preset of PRESETS) {
    const v = pageView({ id: 'kitchen', name: 'Kitchen', preset }, OPTS);
    const p = presetPage(preset, OPTS);
    assert.equal(v.id, 'kitchen');
    assert.equal(v.name, 'Kitchen');
    assert.equal(v.preset, preset);
    assert.deepEqual(v.landscape, p.landscape);
    assert.deepEqual(v.portrait, p.portrait);
  }
});

test('customFromPreset: valid 12×24 pages that look like the preset (12×12 presets doubled)', () => {
  for (const preset of PRESETS) {
    const page = customFromPreset(preset, OPTS, 'p1', 'Copy');
    assert.deepEqual(validatePages([page]), [], preset);
    const view = pageView(page, OPTS);
    for (const portrait of [false, true]) {
      const a = arrangementFor(view, portrait);
      const b = arrangementFor(presetPage(preset, OPTS), portrait);
      // Same widgets in the same places (as fractions of the screen), same overlays.
      assert.deepEqual(a.widgets.map((w) => w.id), b.widgets.map((w) => w.id), preset);
      for (const w of a.widgets) {
        const o = b.widgets.find((x) => x.id === w.id);
        if (w.anchor) assert.deepEqual(w.anchor, o.anchor, `${preset} ${w.id}`);
        else assert.deepEqual(gridBox(w, a), gridBox(o, b), `${preset} ${w.id}`);
      }
    }
  }
});

test('custom pages keep their clock and caption when the settings hide them (back when switched on)', () => {
  const page = customFromPreset('hybrid', OPTS, 'p1', 'Copy');
  const hidden = pageView(page, { ...OPTS, clockVisible: false, caption: { visible: false, corner: 'bottom-left' } });
  assert.equal(hasWidget(hidden.landscape, 'clock_weather'), false);
  assert.equal(hasWidget(hidden.landscape, 'caption'), false);
  assert.equal(hasWidget(page.landscape, 'clock_weather'), true);
});

test('custom pages always get the status icons, over the photo if there is one', () => {
  const bare = { id: 'p', name: 'P',
    landscape: { cols: 12, rows: 24, widgets: [{ id: 'pic', type: 'photo', x: 0, y: 0, w: 12, h: 24 }] },
    portrait: { cols: 12, rows: 24, widgets: [{ id: 'cal', type: 'calendar_day', x: 0, y: 0, w: 12, h: 24 }] } };
  const v = pageView(bare, OPTS);
  assert.deepEqual(v.landscape.widgets.find((w) => w.type === 'status').anchor, { corner: 'bottom-left', over: 'pic' });
  assert.deepEqual(v.portrait.widgets.find((w) => w.type === 'status').anchor, { corner: 'bottom-left' });
});

test('overlays sharing a corner make room for each other, in any corner and box', () => {
  const arr = { cols: 12, rows: 24, widgets: [
    { id: 'photo', type: 'photo', x: 0, y: 0, w: 12, h: 24 },
    { id: 'clock', type: 'clock_weather', style: 'overlay', anchor: { corner: 'top-left', over: 'photo' } },
    { id: 'caption', type: 'caption', anchor: { corner: 'top-left', over: 'photo' } },
    { id: 'icon', type: 'calendar_icon', anchor: { corner: 'top-right' } },
    { id: 'status', type: 'status', anchor: { corner: 'top-left', over: 'photo', lift: true } },
  ] };
  const r = resolveArrangement(arr);
  const a = (id) => r.widgets.find((w) => w.id === id).anchor;
  assert.deepEqual(a('clock'), { corner: 'top-left', over: 'photo', lift: true }, 'lifted off the status icons');
  assert.deepEqual(a('caption'), { corner: 'top-right', over: 'photo' }, 'moved aside from the clock; the icon is in another box');
  assert.deepEqual(a('status'), { corner: 'top-left', over: 'photo' }, 'stored flags are recomputed');
  assert.deepEqual(a('icon'), { corner: 'top-right' });
  assert.equal(arr.widgets[1].anchor.lift, undefined, 'the input is not changed');
});

test('validatePages accepts built-in and custom pages and the home id', () => {
  const pages = [{ id: 'home', name: 'Hybrid', preset: 'hybrid' }, customFromPreset('pictures', OPTS, 'pics', 'Pictures')];
  assert.deepEqual(validatePages(pages, 'pics'), []);
  assert.deepEqual(validatePages([], ''), []);
  assert.match(validatePages(pages, 'gone').join(), /no page gone/);
  assert.match(validatePages([pages[0], pages[0]]).join(), /used twice/);
  assert.match(validatePages([{ id: 'Bad Id', name: 'x', preset: 'hybrid' }]).join(), /bad id/);
  assert.match(validatePages([{ id: 'a', name: '', preset: 'hybrid' }]).join(), /name/);
  assert.match(validatePages([{ id: 'a', name: 'a', preset: 'hybrid', landscape: {} }]).join(), /built-in/);
  const many = Array.from({ length: MAX_PAGES + 1 }, (_, i) => ({ id: `p${i}`, name: 'P', preset: 'pictures' }));
  assert.match(validatePages(many).join(), /At most 8/);
});

test('validateCustomArrangement: grid size, placement by type, one photo', () => {
  const ok = customFromPreset('hybrid', OPTS, 'p', 'P').landscape;
  assert.deepEqual(validateCustomArrangement(ok), []);
  const w = (widgets) => ({ cols: 12, rows: 24, widgets });
  assert.match(validateCustomArrangement({ ...ok, rows: 12 }).join(), /12×24/);
  assert.match(validateCustomArrangement(w([{ id: 'c', type: 'caption', x: 0, y: 0, w: 1, h: 1 }])).join(), /corner/);
  assert.match(validateCustomArrangement(w([{ id: 'p', type: 'photo', anchor: { corner: 'top-left' } }])).join(), /box on the grid/);
  assert.match(validateCustomArrangement(w([{ id: 'c', type: 'clock_weather', x: 0, y: 0, w: 2, h: 2 }])).join(), /panel/);
  assert.match(validateCustomArrangement(w([{ id: 'x', type: 'ha_dashboard', x: 0, y: 0, w: 2, h: 2 }])).join(), /unknown type/);
  assert.match(validateCustomArrangement(w([{ id: 'd', type: 'calendar_day', x: 0, y: 0, w: 2, h: 2, days: 6 }])).join(), /days/);
  assert.deepEqual(validateCustomArrangement(w([{ id: 'd', type: 'calendar_day', x: 0, y: 0, w: 12, h: 8, days: 5 }])), []);
  assert.match(validateCustomArrangement(w([
    { id: 'a', type: 'photo', x: 0, y: 0, w: 6, h: 24 }, { id: 'b', type: 'photo', x: 6, y: 0, w: 6, h: 24 }])).join(), /only one photo/);
  assert.match(validateCustomArrangement(w([
    { id: 'a', type: 'photo', x: 0, y: 0, w: 7, h: 24 }, { id: 'b', type: 'calendar_day', x: 6, y: 0, w: 6, h: 24 }])).join(), /b overlaps a/);
});

test('with two clocks the caption moves aside from either; both top corners taken: to the bottom (2026-10-19)', () => {
  const arr = (clocks) => ({ cols: 12, rows: 24, widgets: [
    { id: 'photo', type: 'photo', x: 0, y: 0, w: 12, h: 24 },
    ...clocks.map((c, i) => ({ id: 'c' + i, type: 'clock_weather', style: 'overlay', anchor: { corner: c, over: 'photo' } })),
    { id: 'caption', type: 'caption', anchor: { corner: 'top-right', over: 'photo' } }] });
  const cap = (a) => resolveArrangement(a).widgets.find((w) => w.id === 'caption').anchor.corner;
  assert.equal(cap(arr(['bottom-left', 'top-right'])), 'top-left', 'the second clock counts too');
  assert.equal(cap(arr(['top-left', 'top-right'])), 'bottom-right'); // used to stay and overlap the clock
  assert.equal(cap(arr(['bottom-left'])), 'top-right');
});

// ---- weather ----

test('WMO codes map to icons with day/night variants', () => {
  assert.equal(wmoInfo(0, true).icon, 'clear-day');
  assert.equal(wmoInfo(0, false).icon, 'clear-night');
  assert.equal(wmoInfo(2, false).icon, 'partly-night');
  assert.equal(wmoInfo(3).icon, 'cloudy');
  assert.equal(wmoInfo(45).icon, 'fog');
  assert.equal(wmoInfo(53).icon, 'drizzle');
  assert.equal(wmoInfo(63).icon, 'rain');
  assert.equal(wmoInfo(81).icon, 'rain');
  assert.equal(wmoInfo(67).icon, 'sleet');
  assert.equal(wmoInfo(75).icon, 'snow');
  assert.equal(wmoInfo(95).icon, 'thunder');
  assert.equal(wmoInfo(1234).icon, 'cloudy', 'unknown codes degrade gracefully');
});

test('temperatures convert and round; no -0', () => {
  assert.equal(displayTemp(13.8, 'fahrenheit'), 57);
  assert.equal(displayTemp(13.8, 'celsius'), 14);
  assert.equal(displayTemp(-17.8, 'fahrenheit'), 0);
  assert.ok(!Object.is(displayTemp(-0.3, 'celsius'), -0));
  assert.equal(displayTemp(null, 'celsius'), null);
  assert.equal(displayTemp(undefined, 'fahrenheit'), null);
});

test('localDay uses the forecast time zone', () => {
  const t = Date.UTC(2026, 9, 14, 3, 0); // 2026-10-14 03:00 UTC = Oct 13, 20:00 in Seattle
  assert.equal(localDay(t, 'America/Los_Angeles'), '2026-10-13');
  assert.equal(localDay(t, 'Europe/Athens'), '2026-10-14');
});

// Shaped like a real Open-Meteo response (°C), wrapped as /api/weather returns it.
function weather(lastSuccessAt, units = 'fahrenheit') {
  return {
    configured: true, units, status: 'ok', lastSuccessAt,
    forecast: {
      timezone: 'America/Los_Angeles',
      current: { time: '2026-10-13T12:15', temperature_2m: 13.8, weather_code: 1, is_day: 1 },
      daily: {
        time: ['2026-10-13', '2026-10-14', '2026-10-15'],
        weather_code: [3, 51, 61],
        temperature_2m_max: [16.2, 17.4, 21.2],
        temperature_2m_min: [7.4, 10.8, 9.4],
        precipitation_probability_max: [10, 20, 60],
      },
    },
  };
}

test('summary: fresh cache shows current conditions plus today high/low', () => {
  const now = Date.UTC(2026, 9, 13, 19, 30); // 12:30 in Seattle
  const s = summarize(weather(now - 10 * 60000), now);
  assert.deepEqual(s, { icon: 'partly-day', label: 'Mostly clear', temp: 57, feelsLike: null, high: 61, low: 45, precip: 10, current: true });
  assert.equal(summarize(weather(now, 'celsius'), now).temp, 14);
});

test('summary: old cache (offline) falls back to the forecast for today, without a "now" temp', () => {
  const fetched = Date.UTC(2026, 9, 13, 19, 30);
  const now = Date.UTC(2026, 9, 14, 18, 0); // next day, 11:00 in Seattle
  assert.ok(now - fetched > CURRENT_MAX_AGE_MS);
  const s = summarize(weather(fetched), now);
  assert.equal(s.current, false);
  assert.equal(s.temp, null);
  assert.equal(s.icon, 'drizzle'); // code 51 on Oct 14
  assert.equal(s.high, 63);
  assert.equal(s.low, 51);
});

test('summary: nothing to show without a forecast or past the cached days', () => {
  assert.equal(summarize(null), null);
  assert.equal(summarize({ configured: false, forecast: null }), null);
  const fetched = Date.UTC(2026, 9, 13, 19, 30);
  assert.equal(summarize(weather(fetched), Date.UTC(2026, 9, 20, 19, 0)), null);
});

test('high/low: hidden when switched off, unless it stands in for a missing current reading', async () => {
  const { showHighLow } = await import('../../app/src/main/assets/web/lib/weather-core.js');
  const live = { temp: 58, high: 61, low: 45 };
  const stale = { temp: null, high: 61, low: 45 };
  assert.equal(showHighLow(live, { current: true, highLow: true }), true);
  assert.equal(showHighLow(live, { current: true, highLow: false }), false);
  assert.equal(showHighLow(stale, { current: true, highLow: false }), true);
  assert.equal(showHighLow(stale, { current: false, highLow: false }), false);
  assert.equal(showHighLow(null, { current: true, highLow: true }), false);
});

test('feels like comes with a fresh current reading only', () => {
  const now = Date.UTC(2026, 9, 13, 19, 30);
  const w = weather(now - 10 * 60000);
  w.forecast.current.apparent_temperature = 12.2;
  assert.equal(summarize(w, now).feelsLike, 54);
  assert.equal(summarize(weather(now - 10 * 60000), now).feelsLike, null); // field missing
  assert.equal(summarize(weather(now - 5 * 3600000), now).feelsLike, null); // too old
});

test('nextDays: the days after today, with weekday names', async () => {
  const { nextDays } = await import('../../app/src/main/assets/web/lib/weather-core.js');
  const now = Date.UTC(2026, 9, 13, 19, 30); // Tue Oct 13 in Seattle
  const days = nextDays(weather(now), 5, now);
  assert.deepEqual(days.map((d) => [d.day, d.high, d.low, d.icon]), [['Wed', 63, 51, 'drizzle'], ['Thu', 70, 49, 'rain']]);
  assert.equal(nextDays(weather(now), 1, now).length, 1);
  assert.deepEqual(nextDays(weather(now), 0, now), []);
  assert.deepEqual(nextDays(null, 3, now), []);
});
