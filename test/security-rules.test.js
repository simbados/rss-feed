// Mechanical security checks on configuration and source. They run with every `npm test` and
// replace an LLM review for rules that can be checked without judgement (see AGENTS.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('no runtime dependencies; wrangler is the only dev dependency', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.dependencies, undefined, 'runtime dependencies need explicit consent (AGENTS.md)');
  assert.deepEqual(Object.keys(pkg.devDependencies ?? {}), ['wrangler']);
});

test('lockfile only uses the npm registry', () => {
  const lock = JSON.parse(read('package-lock.json'));
  for (const [name, entry] of Object.entries(lock.packages ?? {})) {
    if (entry.resolved) assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//, name);
  }
});

test('.npmrc keeps its supply-chain protections', () => {
  const npmrc = read('.npmrc');
  assert.match(npmrc, /^min-release-age=\d+/m);
  assert.match(npmrc, /^ignore-scripts=true/m);
});

test('CSP: no unsafe keywords, wildcards or scheme-wide sources', () => {
  const index = read('src/index.js');
  const csp = index.slice(index.indexOf('const CSP = ['), index.indexOf("].join('; ')"));
  assert.ok(csp.includes("default-src 'none'"), 'default-src none');
  assert.doesNotMatch(csp, /unsafe-|'\*'|\s\*\s|\*\.|https?:|data:|blob:/, 'CSP must stay self-only');
});

test('every POST passes the same-origin check before handlePost', () => {
  const index = read('src/index.js');
  const calls = index.match(/handlePost\(/g) ?? [];
  assert.equal(calls.length, 2, 'one definition + exactly one call');
  assert.match(
    index,
    /if \(request\.method === 'POST'\) \{\s*if \(!isSameOrigin\(request, url\)\) \{[\s\S]*?return handlePost\(request, env, user, url\);/,
    'the only handlePost call sits behind isSameOrigin'
  );
});

test('authentication and the user lookup run before any routing', () => {
  const index = read('src/index.js');
  const handle = index.slice(index.indexOf('async function handle('));
  const routing = handle.indexOf("request.method === 'GET'");
  assert.ok(handle.indexOf('authenticate(request, env)') > 0 && handle.indexOf('authenticate(request, env)') < routing);
  assert.ok(handle.indexOf('resolveUser(env, auth.email)') > 0 && handle.indexOf('resolveUser(env, auth.email)') < routing);
  assert.ok(handle.indexOf('if (!userId)') > 0 && handle.indexOf('if (!userId)') < routing, 'no user → 401 before routing');
});

test('the dev auth bypass is never configured for deployment', () => {
  assert.doesNotMatch(read('wrangler.toml'), /^\s*DEV_(NO_AUTH|EMAIL)\s*=/m);
  const gitignore = read('.gitignore');
  for (const pattern of ['.dev.vars*', '.env', '.env.*']) assert.ok(gitignore.split('\n').includes(pattern), pattern);
});

test('multi-user: every query on user data is scoped by user_id (except the named cron functions)', async () => {
  const { CRON_ONLY } = await import('../src/db.js');
  // Pinned here on purpose: exempting another function must be a visible change to this test.
  assert.deepEqual(CRON_ONLY, ['dueFeeds', 'insertArticles', 'recordFetch', 'markFetchAttempt', 'purgeOldArticles', 'usersWithDevices']);

  const src = read('src/db.js');
  const USER_TABLES = /\b(topics|feeds|articles|push_subscriptions)\b/;
  // articleWhere builds the WHERE of the article queries; it must start with the user filter.
  assert.match(src, /function articleWhere\(userId, q\) \{\s*const where = \['f\.user_id = \?'/);

  // Only literal SQL can be checked.
  const dynamic = [...src.matchAll(/\.prepare\((?!\s*[`'])[^)]{0,40}/g)].map((m) => m[0]);
  assert.deepEqual(dynamic, [], 'prepare() must be given the SQL literally');

  // Top-level string constants used inside SQL (e.g. OWN_TOPIC) are expanded before checking.
  const constants = Object.fromEntries([...src.matchAll(/^const (\w+) = '([^']*)';/gm)].map((m) => [m[1], m[2]]));
  const expand = (sql) => sql.replace(/\$\{(\w+)\}/g, (all, name) => constants[name] ?? all).replace('${w.sql}', 'f.user_id = ?');

  // Every top-level function — exported or not, declaration or arrow — is its own section.
  const declarations = [
    ...src.matchAll(/^(?:export )?(?:async )?function (\w+)\(([^)]*)\)|^(?:export )?const (\w+) = (?:async )?\(([^)]*)\) =>/gm),
  ].sort((x, y) => x.index - y.index);
  let checked = 0;
  declarations.forEach((m, i) => {
    const name = m[1] ?? m[3];
    const params = m[2] ?? m[4];
    const body = src.slice(m.index, declarations[i + 1]?.index ?? src.length);
    const touching = [...body.matchAll(/\.prepare\(\s*(`[\s\S]*?`|'[^']*')/g)].map((s) => expand(s[1])).filter((sql) => USER_TABLES.test(sql));
    if (!touching.length || CRON_ONLY.includes(name)) return;
    checked++;
    if (name !== 'findOrCreateUser') assert.match(params, /\buserId\b/, `${name} must take userId`);
    for (const sql of touching) {
      const scoped =
        /\buser_id\s*=\s*\?/.test(sql) || // a real filter on the user
        /INSERT (OR \w+ )?INTO (topics|feeds|push_subscriptions) \(user_id\b/.test(sql); // a new row owned by the user
      assert.ok(scoped, `${name}: query not scoped to the user:\n${sql}`);
    }
  });
  assert.ok(checked >= 20, `only ${checked} functions checked — did the parsing break?`);
});
