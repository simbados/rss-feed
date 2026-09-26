# Architecture conventions

How new features plug in, so changes stay small and predictable. `AGENTS.md` has the file overview and
the rules (security, migrations, Cloudflare steps); this file is about the shape of the code.

## 1. The server is the only source of truth
- All business rules live on the server: what counts as unread, what a mute rule hides, who owns what.
- The browser never recomputes them. It shows what the server says.
- Every page works without JavaScript (plain forms, redirects). JavaScript only avoids reloads.

## 2. Actions reply with the state they changed
A `fetch` action (`x-requested-with: fetch`) replies with one JSON shape, the client state patch:
```json
{ "articles": { "84": { "is_read": 1, "is_starred": 0, "is_hidden": 0 } },
  "counts":   { "total": 11, "topics": { "3": 4 } } }
```
- Only the parts that changed; the keys are the same everywhere.
- A new kind of state gets a new top-level key (e.g. `tags` later), documented in `src/client/store.js`.
- Without `x-requested-with: fetch` the same route redirects back (the no-JS path).

## 3. Client state: one store, rendering subscribes
- `src/client/store.js`: `createStore()`, `set(patch)` deep-merges and notifies, `subscribe(fn)`.
- Replies go straight into the store: `store.set(await post(url))`.
- Rendering subscribes and updates only what the patch touched (`renderArticle`, `renderCounts` in
  `src/client/articles.js`).
- Live parts of the server HTML are marked: `data-count="total"`, `data-count="topic:<id>"`,
  `<article data-id>`. Everything else is plain server HTML.

### Known limits (handle when the first feature needs it)
- **Every route that changes counted state must send the counts.** Today only the article actions reply
  with JSON and build `{ articles, counts }` by hand. When a second route does (e.g. mute without a page
  reload), add one server helper, e.g. `clientState(env, user, { articles })`, that always adds `counts`,
  so no route forgets them.
- **`merge` only adds and overwrites, it never deletes.** A key missing from a reply keeps its old value
  in the store. Fine while lists only change with a page reload. For a list that shrinks live, the
  reply must either replace that part as a whole or mark removed entries (like `is_hidden` for
  articles, which `renderArticle` turns into a removal).

## 4. Client code is real, tested modules
- `src/client/*.js`, bundled by wrangler as text (`[[rules]] type = "Text"`), served by `src/index.js`
  through `CLIENT_MODULES` in `src/static.js`. Relative imports get the server's deploy id added
  (`versionImports(module, assetVersion(env))`), so a deploy never mixes new and cached modules. Never
  put request text into served code: the request's `?v=` only selects the caching.
- Features are functions that take their dependencies (`setUpArticles({ document, window, store, post })`),
  so tests run them against small fakes in Node (`test/client.test.js`). `app.js` only wires them up.
- `theme.js` and `sw.js` stay classic scripts (theme must run before first paint; the service worker is
  registered as a classic script).
- No `innerHTML` or other HTML sinks (Trusted Types); `test/xss-rules.test.js` checks `src/client/`.
- A new module: add the file, import it in `src/static.js`, add it to `CLIENT_MODULES`.
  `test/client.test.js` fails if a file or an import is forgotten.

## 5. Feature checklist
1. Migration (additive, new file) if the schema changes.
2. `src/db.js`: functions take `userId`; cross-user cron functions go into `CRON_ONLY`.
3. Route in `src/index.js`: POST for changes, IDs checked for ownership, fetch reply in the shape above.
4. View in `src/views.js` with the `html` template; mark live parts with `data-*`.
5. Client: extend the store shape and a render function, or a new module.
6. Tests: DB and isolation (`test/users.test.js`), views (`test/html.test.js`), client
   (`test/client.test.js`), plus the pinned security rules if a list changes.
7. Touches a security-relevant file (see `AGENTS.md`)? Suggest a diff review before the push.
