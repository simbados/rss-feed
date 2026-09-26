import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIGEST_TIME_ZONE } from '../src/digest.js';
import { PAUSE_TIME_ZONE, isPausedOn, pauseDaysFromForm, todayPauseBit, weekdayIndex } from '../src/pause.js';

test('pause uses the same time zone as the daily summary', () => {
  assert.equal(PAUSE_TIME_ZONE, DIGEST_TIME_ZONE);
});

test('weekday in Europe/Berlin, not UTC (0 = Monday)', () => {
  assert.equal(weekdayIndex(Date.UTC(2026, 8, 25, 12)), 4, 'Fri 2026-09-25 noon');
  assert.equal(weekdayIndex(Date.UTC(2026, 8, 25, 22, 30)), 5, 'Fri 22:30 UTC is already Saturday in Berlin (summer)');
  assert.equal(weekdayIndex(Date.UTC(2026, 11, 27, 23, 30)), 0, 'Sun 23:30 UTC is Monday in Berlin (winter)');
  assert.equal(weekdayIndex(Date.UTC(2026, 9, 25, 0, 30)), 6, 'night of the DST change: still Sunday');
  assert.equal(todayPauseBit(Date.UTC(2026, 8, 27, 12)), 1 << 6, 'Sunday → bit 6');
});

test('pause days from the form: only "0"–"6", duplicates harmless', () => {
  assert.equal(pauseDaysFromForm(['4', '5', '6']), 0b1110000, 'Fri–Sun');
  assert.equal(pauseDaysFromForm(['4', '4']), 1 << 4);
  assert.equal(pauseDaysFromForm(['7', '-1', '1.5', '04', ' 1', 'x', '']), 0, 'anything else ignored');
  assert.equal(pauseDaysFromForm([]), 0);
  assert.ok(isPausedOn(0b1110000, 4) && isPausedOn(0b1110000, 6) && !isPausedOn(0b1110000, 0));
});
