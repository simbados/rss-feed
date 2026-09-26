// @ts-check
// Who is logged in: the email from the verified Access token becomes a user id. A person's reader is
// created on their first login.
//
// Two independent gates decide who may log in at all: the Cloudflare Access policy (emails that get a
// one-time code) AND the Worker secret ALLOWED_EMAILS checked here. A typo in one of them locks a person
// out instead of letting a stranger in (2026-09-26: a mistyped address in the Access policy got a real
// code for ~30 s). ALLOWED_EMAILS is a secret, not a [vars] entry: the repo is public, and deploys
// overwrite plain dashboard variables.

import * as db from './db.js';

/**
 * The email as the account key, or '' if it's not usable. Only A–Z are folded to lower case (the same
 * as SQLite's NOCASE): JavaScript's Unicode toLowerCase would map e.g. the Kelvin sign "K" onto "k",
 * letting a different address land in someone else's account. Anything that isn't plain printable
 * ASCII — including surrounding whitespace — is rejected instead of cleaned up.
 * @param {unknown} email
 */
export function normalizeEmail(email) {
  const raw = String(email ?? '');
  // Printable ASCII without "@" on both sides of exactly one "@".
  if (!/^[\x21-\x3f\x41-\x7e]+@[\x21-\x3f\x41-\x7e]+$/.test(raw) || raw.length > 320) return '';
  return raw.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/**
 * The allowed emails from the ALLOWED_EMAILS secret (separated by commas, spaces or newlines), normalised.
 * Entries that aren't usable emails are ignored.
 * @param {unknown} value
 */
export function parseAllowedEmails(value) {
  return new Set(
    String(value ?? '')
      .split(/[\s,]+/)
      .map(normalizeEmail)
      .filter(Boolean)
  );
}

/**
 * The user for a verified login email, or why there is none (every error fails closed):
 * - `no-email`: the token carries no usable email (e.g. an Access service token) → 401
 * - `not-configured`: ALLOWED_EMAILS is missing or empty → 403 for everyone
 * - `not-allowed`: the email isn't on ALLOWED_EMAILS → 403
 * The local dev bypass (DEV_NO_AUTH, .dev.vars only) skips the list; it skips Access too.
 * @param {any} env @param {string} email
 * @returns {Promise<{ id: number, created: boolean } | { error: 'no-email' | 'not-configured' | 'not-allowed' }>}
 */
export async function resolveUser(env, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { error: 'no-email' };
  if (env.DEV_NO_AUTH !== '1') {
    const allowed = parseAllowedEmails(env.ALLOWED_EMAILS);
    if (!allowed.size) return { error: 'not-configured' };
    if (!allowed.has(normalized)) return { error: 'not-allowed' };
  }
  return db.findOrCreateUser(env.DB, normalized);
}
