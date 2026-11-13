// Makes the built workspace packages self-contained (WP-J task J6, AC1006; decision E14). The packages compile
// against the phase-one modules in src/ (single source, decision E4); after `tsc -b` this copies the transitive
// closure of those modules (and their .d.ts type boundaries) into each package's dist/_phase1/ and rewrites the
// `../../../src/...` specifiers in dist to point there. Idempotent; run after every package build.
// Usage: node scripts/vendor-phase1.mjs [--check]
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const src = path.join(root, 'src');
const PACKAGES = ['generators', 'builder', 'map', 'styles-ink', 'details'];
const SPECIFIER = /((?:from|import)\s*\(?\s*['"])([^'"]+)(['"])/g;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e !== '_phase1') walk(p, out);
    } else if (/\.(js|d\.ts)$/.test(e)) out.push(p);
  }
  return out;
}

const bare = new Set();
/** Copies one src module (and its .d.ts if present) into vendorRoot, following relative imports inside src. */
function vendor(file, vendorRoot, done) {
  if (done.has(file)) return;
  done.add(file);
  const rel = path.relative(src, file);
  const target = path.join(vendorRoot, rel);
  mkdirSync(path.dirname(target), { recursive: true });
  let text = readFileSync(file, 'utf8');
  // src/ modules that import a workspace package by path (e.g. ../packages/landmarks/index.js) import it by name.
  text = text.replace(SPECIFIER, (all, pre, spec, post) => {
    if (!spec.startsWith('.')) return all;
    const dep = path.resolve(path.dirname(file), spec);
    const pkgRoot = path.join(root, 'packages');
    if (!dep.startsWith(pkgRoot + path.sep)) return all;
    const [dir, ...rest] = path.relative(pkgRoot, dep).split(path.sep);
    const manifest = JSON.parse(readFileSync(path.join(pkgRoot, dir, 'package.json'), 'utf8'));
    const sub = rest.join('/');
    const exported = Object.entries(manifest.exports ?? {}).find(
      ([, v]) => (typeof v === 'string' ? v : v.import) === `./${sub}`,
    );
    if (!exported) throw new Error(`${rel} imports ${spec}, which ${manifest.name} does not export`);
    return `${pre}${manifest.name}${exported[0] === '.' ? '' : exported[0].slice(1)}${post}`;
  });
  for (const m of text.matchAll(SPECIFIER)) {
    const spec = m[2];
    if (spec.startsWith('.')) {
      const dep = path.resolve(path.dirname(file), spec);
      if (!dep.startsWith(src + path.sep)) throw new Error(`${rel} imports ${spec} outside src/`);
      if (existsSync(dep)) vendor(dep, vendorRoot, done);
    } else if (!spec.startsWith('node:'))
      bare.add(
        spec
          .split('/')
          .slice(0, spec.startsWith('@') ? 2 : 1)
          .join('/'),
      );
  }
  writeFileSync(target, text);
  const dts = file.replace(/\.js$/, '.d.ts');
  if (file.endsWith('.js') && existsSync(dts)) vendor(dts, vendorRoot, done);
}

const report = {};
for (const name of PACKAGES) {
  const dist = path.join(root, 'packages', name, 'dist');
  if (!existsSync(dist)) continue;
  const vendorRoot = path.join(dist, '_phase1');
  const done = new Set();
  bare.clear();
  let rewritten = 0;
  for (const file of walk(dist)) {
    let changed = false;
    const text = readFileSync(file, 'utf8').replace(SPECIFIER, (all, pre, spec, post) => {
      // A dist file at packages/<name>/dist/<sub>/x.js was compiled from packages/<name>/src/<sub>/x.ts, so its
      // `../../../src/...` (plus one `..` per sub-folder) resolves against the source location.
      if (!spec.startsWith('.')) return all;
      // Already rewritten by an earlier run: refresh the vendored copy from src/ (tsc -b may not re-emit the file).
      const local = path.resolve(path.dirname(file), spec);
      if (local.startsWith(vendorRoot + path.sep) && !file.startsWith(vendorRoot + path.sep)) {
        const original = path.join(src, path.relative(vendorRoot, local));
        if (existsSync(original)) vendor(original, vendorRoot, done);
        else if (existsSync(original.replace(/\.js$/, '.d.ts')))
          vendor(original.replace(/\.js$/, '.d.ts'), vendorRoot, done);
        return all;
      }
      const source = path.join(root, 'packages', name, 'src', path.relative(dist, path.dirname(file)));
      const resolved = path.resolve(source, spec);
      if (!resolved.startsWith(src + path.sep)) return all;
      const module = existsSync(resolved) ? resolved : resolved.replace(/\.js$/, '.d.ts');
      if (existsSync(module))
        vendor(
          module.endsWith('.d.ts') && existsSync(module.replace(/\.d\.ts$/, '.js'))
            ? module.replace(/\.d\.ts$/, '.js')
            : module,
          vendorRoot,
          done,
        );
      let next = path
        .relative(path.dirname(file), path.join(vendorRoot, path.relative(src, resolved)))
        .replace(/\\/g, '/');
      if (!next.startsWith('.')) next = `./${next}`;
      changed = true;
      return `${pre}${next}${post}`;
    });
    if (changed) {
      writeFileSync(file, text);
      rewritten++;
    }
  }
  report[name] = { rewrittenFiles: rewritten, vendoredModules: done.size, bareImports: [...bare].sort() };
}
console.log(JSON.stringify(report));
