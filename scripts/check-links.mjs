// Relative-link check for the documentation (AC1010): every local link in README*, CONTRIBUTING, ROADMAP and docs/
// (except archived phase-one evidence) must point at an existing file. External URLs are not fetched.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['README.md', 'README.zh-CN.md', 'CONTRIBUTING.md', 'ROADMAP.md', 'AGENTS.md'].map((f) =>
  path.join(root, f),
);
const walk = (dir) => {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) {
      if (!/phase1-evidence/.test(p)) walk(p);
    } else if (p.endsWith('.md')) files.push(p);
  }
};
walk(path.join(root, 'docs'));
const broken = [];
for (const file of files.filter(existsSync)) {
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1].split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    if (!existsSync(path.resolve(path.dirname(file), decodeURIComponent(target))))
      broken.push(`${path.relative(root, file)} -> ${m[1]}`);
  }
}
console.log(JSON.stringify({ files: files.length, broken }));
if (broken.length) process.exitCode = 1;
