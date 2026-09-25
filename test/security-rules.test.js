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
    /if \(request\.method === 'POST'\) \{\s*if \(!isSameOrigin\(request, url\)\) \{[\s\S]*?return handlePost\(request, env, url\);/,
    'the only handlePost call sits behind isSameOrigin'
  );
});

test('authentication runs before any routing', () => {
  const index = read('src/index.js');
  const handle = index.slice(index.indexOf('async function handle('));
  assert.ok(handle.indexOf('authenticate(request, env)') < handle.indexOf("request.method === 'GET'"));
});

test('the dev auth bypass is never configured for deployment', () => {
  assert.doesNotMatch(read('wrangler.toml'), /^\s*DEV_NO_AUTH\s*=/m);
  const gitignore = read('.gitignore');
  for (const pattern of ['.dev.vars*', '.env', '.env.*']) assert.ok(gitignore.split('\n').includes(pattern), pattern);
});
