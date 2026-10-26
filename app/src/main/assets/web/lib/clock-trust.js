// Whether this screen's clock can be believed (SPEC §18). The frame boots with a stale date (no
// battery-backed clock) until network time arrives; until then the clock, weather, and day panel show
// "--" (user request 2026-10-16). Other browsers keep their own clock, so it stays true there.

let known = true;
const listeners = new Set();

export function clockKnown() { return known; }

export function onClockKnown(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Sets the state (the frame's status poll); listeners run only on a change. */
export function setClockKnown(value) {
  const v = !!value;
  if (v === known) return;
  known = v;
  listeners.forEach((fn) => fn(v));
}

export const UNKNOWN = '--';
