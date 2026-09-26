// Loads src/client/* the way wrangler does (wrangler.toml [[rules]] "Text"): when src/static.js imports
// a client file, it gets the file's source as a string, not a running module. Tests that import a
// client module directly (e.g. src/client/store.js) still get the real module.
// Registered for every test file via `node --import` in the npm test script.
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    const resolved = next(specifier, context);
    if (context.parentURL?.endsWith('/src/static.js') && specifier.startsWith('./client/')) {
      return { ...resolved, url: `${resolved.url}?as=text`, shortCircuit: true };
    }
    return resolved;
  },
  load(url, context, next) {
    if (url.endsWith('?as=text')) {
      const source = readFileSync(new URL(url.slice(0, -'?as=text'.length)), 'utf8');
      return { format: 'module', source: `export default ${JSON.stringify(source)};`, shortCircuit: true };
    }
    return next(url, context);
  },
});
