// @ts-check
// Daily summary notification at 19:00 Europe/Berlin. Cloudflare crons run in UTC, so the
// 30-minute cron asks "is it past 19:00 locally and not sent today?" — DST-safe, catches up after
// a failed run, never sends twice.

import * as db from './db.js';
import { sendToAll } from './push.js';

export const DIGEST_TIME_ZONE = 'Europe/Berlin';
export const DIGEST_HOUR = 19;
const MAX_BODY = 200;

/**
 * Local calendar date and hour in `timeZone`.
 * @param {number} now epoch ms @param {string} timeZone
 */
export function localDateHour(now, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(now))
      .map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/**
 * Today's local date if the summary is due, else null.
 * @param {number} now @param {string|null} lastSentDate
 */
export function digestDueDate(now, lastSentDate) {
  const { date, hour } = localDateHour(now, DIGEST_TIME_ZONE);
  return hour >= DIGEST_HOUR && date !== lastSentDate ? date : null;
}

/**
 * Notification text from per-feed counts, or null when there is nothing new.
 * The order (and later a selection) is decided here — this is where scoring will plug in.
 * @param {{ title: string, count: number }[]} rows
 * @returns {import('./push.js').PushMessage | null}
 */
export function buildDigest(rows) {
  const total = rows.reduce((n, r) => n + r.count, 0);
  if (!total) return null;
  const body = [...rows]
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
    .map((r) => `${r.title} ${r.count}`)
    .join(' · ');
  return {
    title: `RSS: ${total} new`,
    body: body.length > MAX_BODY ? `${body.slice(0, MAX_BODY - 1)}…` : body,
    url: '/',
    tag: 'daily-digest',
  };
}

/** Called from the cron. @param {any} env @param {number} [now] */
export async function maybeSendDigest(env, now = Date.now()) {
  const due = digestDueDate(now, await db.getState(env.DB, 'digest_date'));
  if (!due) return;
  const since = Number(await db.getState(env.DB, 'digest_since')) || now - 86_400_000;
  const rows = await db.newArticleCounts(env.DB, since, 'daily');
  // Mark as done before sending, so a partial failure never leads to a second summary.
  await db.setState(env.DB, 'digest_date', due);
  await db.setState(env.DB, 'digest_since', String(now));

  const message = buildDigest(rows);
  if (!message) {
    console.log(`digest ${due}: nothing new`);
    return;
  }
  const r = await sendToAll(env, message);
  console.log(`digest ${due}: ${message.title}; sent ${r.sent}, failed ${r.failed}${r.error ? ` (${r.error})` : ''}`);
}
