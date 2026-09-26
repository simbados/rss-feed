// @ts-check
// Daily summary notification at 19:00 Europe/Berlin. Cloudflare crons run in UTC, so the
// 30-minute cron asks "is it past 19:00 locally and not sent today?" — DST-safe, catches up after
// a failed run, never sends twice.

import * as db from './db.js';
import { sendToUser } from './push.js';

export const DIGEST_TIME_ZONE = 'Europe/Berlin';
export const DIGEST_HOUR = 19;
const MAX_BODY = 200;
const MAX_SITES = 5;

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
 * Short site name for the summary: the domain without "www." ("lebensmittelwarnung.de"), taken from the
 * site URL, else the feed URL, else the feed title.
 * @param {{ title: string, siteUrl?: string, feedUrl?: string }} row
 */
export function siteName(row) {
  for (const url of [row.siteUrl, row.feedUrl]) {
    try {
      // Only real web addresses: "urn:x", "mailto:…" or "data:,x" parse fine but have no host.
      const u = new URL(url ?? '');
      if ((u.protocol === 'https:' || u.protocol === 'http:') && u.hostname) return u.hostname.replace(/^www\./, '');
    } catch {}
  }
  return row.title || '?';
}

/**
 * Notification text from per-feed counts, or null when there is nothing new.
 * Feeds of the same site are added up; the top sites are listed, the rest as "+N more".
 * The order (and later a selection) is decided here — this is where scoring will plug in.
 * @param {{ title: string, siteUrl?: string, feedUrl?: string, count: number }[]} rows
 * @returns {import('./push.js').PushMessage | null}
 */
export function buildDigest(rows) {
  /** @type {Map<string, number>} */
  const perSite = new Map();
  for (const r of rows) perSite.set(siteName(r), (perSite.get(siteName(r)) ?? 0) + r.count);
  const total = [...perSite.values()].reduce((n, c) => n + c, 0);
  if (!total) return null;

  const sites = [...perSite].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = sites.slice(0, MAX_SITES).map(([name, c]) => `${name} ${c}`);
  if (sites.length > MAX_SITES) shown.push(`+${sites.length - MAX_SITES} more`);
  const body = shown.join(' · ');
  return {
    title: `${total} new`, // iOS already shows the app name above it
    body: body.length > MAX_BODY ? `${body.slice(0, MAX_BODY - 1)}…` : body,
    url: '/',
    tag: 'daily-digest',
  };
}

/**
 * Called from the cron: the summary for every user who has a device with notifications on.
 * One user's failure doesn't stop the others.
 * @param {any} env @param {number} [now]
 */
export async function maybeSendDigest(env, now = Date.now()) {
  for (const userId of await db.usersWithDevices(env.DB)) {
    await sendDigestFor(env, userId, now).catch((err) => console.error(`digest for user ${userId} failed`, err));
  }
}

/** @param {any} env @param {number} userId @param {number} now */
async function sendDigestFor(env, userId, now) {
  const due = digestDueDate(now, await db.getState(env.DB, `digest_date:${userId}`));
  if (!due) return;
  const since = Number(await db.getState(env.DB, `digest_since:${userId}`)) || now - 86_400_000;
  const rows = await db.newArticleCounts(env.DB, userId, since, 'daily');
  // Mark as done before sending, so a partial failure never leads to a second summary.
  await db.setState(env.DB, `digest_date:${userId}`, due);
  await db.setState(env.DB, `digest_since:${userId}`, String(now));

  const message = buildDigest(rows);
  if (!message) {
    console.log(`digest ${due} user ${userId}: nothing new`);
    return;
  }
  const r = await sendToUser(env, userId, message);
  console.log(`digest ${due} user ${userId}: ${message.title}; sent ${r.sent}, failed ${r.failed}${r.error ? ` (${r.error})` : ''}`);
}
