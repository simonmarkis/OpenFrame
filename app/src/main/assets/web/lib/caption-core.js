// Photo caption text and placement (SPEC §8), shared by the caption widget, the settings preview,
// and the Node tests (tests/layout/).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 13, 2026" for the photo's date taken, in the display time zone (`tz` undefined = the device's). */
export function captionDate(takenAt, tz) {
  if (takenAt == null) return null;
  const d = new Date(takenAt);
  if (Number.isNaN(d.getTime())) return null;
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d)) {
    parts[p.type] = p.value;
  }
  return `${MONTHS[Number(parts.month) - 1]} ${Number(parts.day)}, ${parts.year}`;
}

/**
 * What the caption shows for `slide` ({ comment, place, takenAt }) with config.caption `c`:
 * `{ main, sub }`, either may be null; both null = no bubble.
 * Two lines: the comment on top (`main`, larger), "Place · Date" below (`sub`, smaller; alone when
 * there's no comment). One line: everything in `main`.
 */
export function captionText(slide, c, tz) {
  if (!slide) return { main: null, sub: null };
  const comment = c.showComment && slide.comment ? slide.comment : null;
  const details = [c.showLocation ? slide.place : null, c.showDate ? captionDate(slide.takenAt, tz) : null].filter(Boolean);
  const detailText = details.length ? details.join(' · ') : null;
  if (c.lines === 'one') {
    const all = [comment, detailText].filter(Boolean);
    return { main: all.length ? all.join(' · ') : null, sub: null };
  }
  return { main: comment, sub: detailText };
}

const SWAP = { 'top-left': 'top-right', 'top-right': 'top-left', 'bottom-left': 'bottom-right', 'bottom-right': 'bottom-left' };

/** The caption's corner: its own, moved to the other side when the clock overlay sits there. */
export function captionCorner(corner, clockCorner, clockOverlay) {
  return clockOverlay && corner === clockCorner ? SWAP[corner] : corner;
}

const FLIP = { 'top-left': 'bottom-left', 'top-right': 'bottom-right', 'bottom-left': 'top-left', 'bottom-right': 'top-right' };

/**
 * Where the caption goes when clocks sit in corners of its box (`hasClock(corner)`): its own corner if free,
 * else the other side, else the other edge on its side ("top-left" → "bottom-left"), else the last corner;
 * clocks in all four: its own (SPEC §8; 2026-10-19: with clocks in both top corners it used to overlap one).
 */
export function captionFreeCorner(corner, hasClock) {
  for (const c of [corner, SWAP[corner], FLIP[corner], SWAP[FLIP[corner]]]) if (!hasClock(c)) return c;
  return corner;
}
