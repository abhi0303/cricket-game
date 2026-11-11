import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

// Browser-only modules (they need three.js and the DOM) can't be loaded in Node, so this checks the wiring
// statically: every name imported from a local module is exported by it. A missing export otherwise only
// shows up as a blank page in the browser.
const walk = d => readdirSync(d).flatMap(f => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.js') ? [join(d, f)] : []));
const exportsOf = file => {
  const src = readFileSync(file, 'utf8'), names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  // export const A = 1, B = 2;  (every declarator on the line)
  for (const m of src.matchAll(/^export\s+(?:const|let|var)\s+(.+)$/gm)) for (const d of m[1].matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*=/g)) names.add(d[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) names.add(n); }
  return names;
};

test('every named import from a local module is exported by it', () => {
  const problems = [];
  for (const file of walk('src')) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/^import\s*\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]/gm)) {
      const target = resolve(dirname(file), m[2]);
      const have = exportsOf(target);
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0];
        if (name && !have.has(name)) problems.push(`${file}: '${name}' is not exported by ${m[2]}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});
