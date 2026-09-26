// @ts-check
// Topic pauses: on the weekdays set in topics.pause_days (bit 0 = Monday … bit 6 = Sunday), the topic
// is left out of the "All" timeline and its unread total. Nothing about the articles changes, so they
// show up in "All" again on the next day that isn't paused.

/** Same zone as the daily summary (DIGEST_TIME_ZONE in src/digest.js; test/pause.test.js checks it). */
export const PAUSE_TIME_ZONE = 'Europe/Berlin';
export const WEEKDAYS = /** @type {const} */ (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

const weekdayFormat = new Intl.DateTimeFormat('en-US', { timeZone: PAUSE_TIME_ZONE, weekday: 'short' });

/** Weekday in Europe/Berlin: 0 = Monday … 6 = Sunday. @param {number} now epoch ms */
export function weekdayIndex(now) {
  return WEEKDAYS.indexOf(/** @type {any} */ (weekdayFormat.format(new Date(now))));
}

/** The pause_days bit for today (Europe/Berlin). @param {number} [now] epoch ms */
export function todayPauseBit(now = Date.now()) {
  return 1 << weekdayIndex(now);
}

/**
 * Bitmask from the form's checkbox values ("0" … "6"); anything else is ignored.
 * @param {unknown[]} values
 */
export function pauseDaysFromForm(values) {
  let mask = 0;
  for (const v of values) {
    const i = Number(v);
    if (Number.isInteger(i) && i >= 0 && i < WEEKDAYS.length && String(v) === String(i)) mask |= 1 << i;
  }
  return mask;
}

/** @param {number} mask @param {number} day 0 = Monday */
export function isPausedOn(mask, day) {
  return (mask & (1 << day)) !== 0;
}
