'use strict';
// Izveido vienu pašpietiekamu failu dist/app.ts (serveris + visas publiskās lapas),
// ko var palaist ar Bun vai Node — piemēram, kā Railway Function.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const modules = {
  './lib/util': read('lib/util.js'),
  './lib/store': read('lib/store.js').replace("require('./util')", "require('./lib/util')"),
  './server': read('server.js')
};

const pub = {};
(function walk(dir) {
  for (const f of fs.readdirSync(path.join(ROOT, 'public', dir))) {
    const rel = dir ? `${dir}/${f}` : f;
    if (fs.statSync(path.join(ROOT, 'public', rel)).isDirectory()) walk(rel);
    else pub[rel] = read(`public/${rel}`);
  }
})('');

const out = `// @ts-nocheck
/* Automātiski ģenerēts ar scripts/build-single.js — nerediģēt manuāli. */
import * as __fs from 'node:fs';
import * as __path from 'node:path';
import * as __crypto from 'node:crypto';
import * as __http from 'node:http';

globalThis.__EMBEDDED_PUBLIC = ${JSON.stringify(pub)};

const __builtins = { fs: __fs, path: __path, crypto: __crypto, http: __http };
const __factories = {
${Object.entries(modules).map(([name, src]) => `  ${JSON.stringify(name)}: function (module, exports, require, __dirname) {\n${src.replace(/^'use strict';\n/, '')}\n  }`).join(',\n')}
};
const __cache = {};
function __require(name) {
  if (__builtins[name]) return __builtins[name];
  if (name.startsWith('node:') && __builtins[name.slice(5)]) return __builtins[name.slice(5)];
  if (__cache[name]) return __cache[name].exports;
  const f = __factories[name];
  if (!f) throw new Error('Modulis nav atrasts: ' + name);
  const module = { exports: {} };
  __cache[name] = module;
  f(module, module.exports, (n) => __require(n === '../lib/store' ? './lib/store' : n === '../lib/util' ? './lib/util' : n), process.cwd());
  return module.exports;
}
__require('./server');
`;

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', 'app.ts'), out);
console.log(`dist/app.ts izveidots (${(out.length / 1024).toFixed(0)} KB, ${Object.keys(pub).length} publiskie faili)`);
