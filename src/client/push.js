// @ts-check
// Notifications box on the Feeds page: subscribe this device to the daily summary.

/**
 * @param {any} box the .push section (data-key = VAPID public key)
 * @param {{ navigator: any, window: any, postJson: (url: string, body: unknown) => Promise<any> }} deps
 */
export async function setUpPush(box, { navigator, window, postJson }) {
  const status = box.querySelector('.push-status');
  const [on, off, test] = ['on', 'off', 'test'].map((k) => box.querySelector('[data-push="' + k + '"]'));
  const say = (/** @type {string} */ text) => {
    status.textContent = text;
  };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    say('On iPhone, notifications need the installed app: Share → Add to Home Screen, then open it from there.');
    return;
  }
  const Notification = window.Notification;
  if (!box.dataset.key) {
    say('Not configured on the server (VAPID_PUBLIC_KEY is missing).');
    return;
  }
  const reg = await navigator.serviceWorker.ready;

  const show = async () => {
    const sub = await reg.pushManager.getSubscription();
    on.hidden = !!sub;
    off.hidden = test.hidden = !sub;
    say(
      sub
        ? 'On for this device – daily summary at 19:00.'
        : Notification.permission === 'denied'
          ? 'Blocked – allow notifications for this app in the system settings.'
          : 'Off for this device.'
    );
  };
  const run = (/** @type {() => Promise<void>} */ fn) => async () => {
    try {
      await fn();
    } catch (err) {
      say('Failed: ' + /** @type {Error} */ (err).message);
      return;
    }
    await show();
  };

  on.addEventListener(
    'click',
    run(async () => {
      // Must be the first await: iOS only asks when called directly from the tap.
      if ((await Notification.requestPermission()) !== 'granted') return;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(box.dataset.key) });
      await postJson('/push/subscribe', sub.toJSON());
    })
  );
  off.addEventListener(
    'click',
    run(async () => {
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;
      await postJson('/push/unsubscribe', { endpoint: sub.endpoint });
      await sub.unsubscribe();
    })
  );
  test.addEventListener('click', async () => {
    try {
      const r = await postJson('/push/test', {});
      say(r.sent ? 'Test notification sent.' : 'Not sent: ' + r.error);
    } catch (err) {
      say('Failed: ' + /** @type {Error} */ (err).message);
    }
  });
  await show();
}

/** @param {string} s base64url */
export function b64urlToBytes(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
