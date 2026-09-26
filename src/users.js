// @ts-check
// Who is logged in: the email from the verified Access token becomes a user id. A person's reader is
// created on their first login; who may log in at all is decided by the Access policy.

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
 * User id for a verified login email, or null (fail closed) when the token carries no usable email —
 * e.g. an Access service token.
 * @param {any} env @param {string} email
 * @returns {Promise<number | null>}
 */
export async function resolveUser(env, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return db.findOrCreateUser(env.DB, normalized);
}
