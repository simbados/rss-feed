// Static checks on the source code for the XSS rules listed at the top of src/views.js.
// They catch the typical mistakes a future edit could introduce; they don't replace review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const srcDir = new URL('../src/', import.meta.url);
const files = readdirSync(srcDir)
  .filter((f) => f.endsWith('.js'))
  .map((name) => ({ name, lines: readFileSync(new URL(name, srcDir), 'utf8').split('\n') }));

/** Lines (outside comments) matching `re`, as "file:line: text". */
function offending(re, only = () => true) {
  const hits = [];
  for (const { name, lines } of files.filter((f) => only(f.name))) {
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // skip comment lines
      if (re.test(line)) hits.push(`${name}:${i + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

test('rule 2: attributes with interpolated values are quoted', () => {
  // Only page templates build HTML attributes; elsewhere "x=${...}" is e.g. log text.
  // An attribute name follows whitespace; "?v=${…}" inside a quoted URL is not an attribute.
  assert.deepEqual(offending(/\s[\w-]+=\$\{/, (f) => f === 'views.js'), []);
});

test('rule 3: interpolated href/src/action start with safeUrl() or qs()', () => {
  const hits = offending(/(href|src|action)="\$\{(?!safeUrl\(|qs\()/);
  assert.deepEqual(hits, []);
});

test('rule 1: raw() is not used outside html.js', () => {
  assert.deepEqual(offending(/\braw\(/, (f) => f !== 'html.js'), []);
});

test('rule 4: no inline handlers, inline styles or inline scripts in views', () => {
  assert.deepEqual(offending(/\son[a-z]+\s*=\s*["'$]|\sstyle\s*=|<script(?![^>]*\bsrc=)/i, (f) => f === 'views.js'), []);
});

test('client scripts use no HTML-parsing DOM sinks', () => {
  const clientDir = new URL('../src/client/', import.meta.url);
  const sinks = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|setTimeout\(\s*['"`]/;
  const hits = readdirSync(clientDir)
    .filter((f) => f.endsWith('.js'))
    .flatMap((name) =>
      readFileSync(new URL(name, clientDir), 'utf8')
        .split('\n')
        .map((line, i) => (sinks.test(line) && !/^\s*(\/\/|\*)/.test(line) ? `${name}:${i + 1}: ${line.trim()}` : null))
        .filter(Boolean)
    );
  assert.ok(readdirSync(clientDir).includes('app.js'), 'client dir found');
  assert.deepEqual(hits, []);
});
