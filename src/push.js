// @ts-check
// Sending to every subscribed device, and validating new subscriptions from the page.

import * as db from './db.js';
import { b64urlDecode, sendPush, vapidFromEnv } from './webpush.js';

/**
 * @typedef {{ title: string, body: string, url: string, tag: string }} PushMessage
 *   What the service worker shows; `url` must be a path on this site (the worker enforces it).
 */

/**
 * Send to all subscriptions; drops the ones the push service reports as gone.
 * @param {any} env @param {PushMessage} message
 * @returns {Promise<{ sent: number, failed: number, error: string }>}
 */
export async function sendToAll(env, message) {
  const vapid = vapidFromEnv(env);
  if (!vapid) return { sent: 0, failed: 0, error: 'push is not configured (VAPID keys missing)' };
  // Rows that didn't come through parseSubscription (older data, other code paths) never get a request.
  const subs = [];
  for (const s of await db.listSubscriptions(env.DB)) {
    if (isPushServiceHost(hostOf(s.endpoint))) subs.push(s);
    else await db.deleteSubscription(env.DB, s.endpoint);
  }
  if (!subs.length) return { sent: 0, failed: 0, error: 'no device has notifications turned on' };

  const results = await Promise.all(subs.map((s) => sendPush(s, message, vapid)));
  let sent = 0;
  let error = '';
  await Promise.all(
    results.map((r, i) => {
      if (r.ok) {
        sent++;
        return null;
      }
      error ||= r.error;
      return r.gone ? db.deleteSubscription(env.DB, subs[i].endpoint) : db.setSubscriptionError(env.DB, subs[i].id, r.error);
    })
  );
  return { sent, failed: subs.length - sent, error };
}

/** @param {string} url */
function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Push services of the browsers we support (Safari/iOS, Chrome/Edge via FCM, Firefox, Edge via WNS).
 * The Worker sends signed requests only to these hosts, never to an endpoint chosen by the client.
 * @param {string} host
 */
export function isPushServiceHost(host) {
  return (
    host === 'web.push.apple.com' ||
    host === 'fcm.googleapis.com' ||
    host === 'updates.push.services.mozilla.com' ||
    host.endsWith('.notify.windows.com')
  );
}

/**
 * A subscription as sent by the page (PushSubscription.toJSON()), or null if malformed.
 * @param {any} json
 */
export function parseSubscription(json) {
  const endpoint = typeof json?.endpoint === 'string' ? json.endpoint : '';
  const p256dh = typeof json?.keys?.p256dh === 'string' ? json.keys.p256dh : '';
  const auth = typeof json?.keys?.auth === 'string' ? json.keys.auth : '';
  try {
    const u = new URL(endpoint);
    if (u.protocol !== 'https:' || !isPushServiceHost(u.hostname) || endpoint.length > 2000) return null;
    if (b64urlDecode(p256dh).length !== 65 || b64urlDecode(auth).length !== 16) return null;
  } catch {
    return null;
  }
  return { endpoint, p256dh, auth };
}
