// @ts-check
// Client state. The server is the only source of truth: every action replies with the state it
// changed, the reply is merged in here, and subscribers re-render what depends on it. The browser
// never computes business rules itself (e.g. unread counts).
//
// State shape (all parts optional):
//   { articles: { [id]: { is_read, is_starred, is_hidden } },
//     counts:   { total: number, topics: { [topicId]: number } } }

/** @typedef {Record<string, any>} State */

/**
 * `patch` merged into `state`: nested plain objects are merged, everything else is replaced.
 * Returns a new object; `state` is not modified.
 * @param {State} state @param {State} patch @returns {State}
 */
export function merge(state, patch) {
  /** @type {State} */
  const out = { ...state };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isPlainObject(value) && isPlainObject(state[key]) ? merge(state[key], value) : value;
  }
  return out;
}

/** @param {unknown} v @returns {v is State} */
function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * @param {State} [initial]
 */
export function createStore(initial = {}) {
  let state = initial;
  /** @type {Set<(state: State, patch: State) => void>} */
  const subscribers = new Set();
  return {
    get: () => state,
    /** Merge a server reply (or any patch) and notify subscribers with the new state and the patch. @param {State} patch */
    set(patch) {
      state = merge(state, patch);
      for (const fn of subscribers) fn(state, patch);
    },
    /** @param {(state: State, patch: State) => void} fn @returns {() => void} unsubscribe */
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
