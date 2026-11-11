// Package file-list check for the phase-two workspaces (WP-A, A4/AC108).
// Usage: node scripts/phase2-pack-check.mjs [--json]
// Each publishable workspace may only ship its build output, typings, README, LICENSE and package.json.
// The root package must not pick up the new phase-two workspaces.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.env.npm_execpath;
const run = (cwd) => {
  const args = ['pack', '--dry-run', '--json', '--ignore-scripts'];
  const output = npm
    ? execFileSync(process.execPath, [npm, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    : execFileSync('npm', args, {
        cwd,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
  return JSON.parse(output)[0].files.map((file) => file.path.replace(/\\/g, '/'));
};

const phase2 = ['tiles', 'generators', 'builder', 'map', 'styles-ink', 'details'];
const allowed = /^(?:dist\/.+\.(?:js|d\.ts|js\.map|d\.ts\.map|json)|README\.md|LICENSE|package\.json)$/;
const report = { status: 'pass', packages: {}, problems: [] };
for (const name of phase2) {
  const dir = path.join(root, 'packages', name);
  const files = run(dir);
  const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const unexpected = files.filter((file) => !allowed.test(file) || file.endsWith('.tsbuildinfo'));
  if (!files.includes('dist/index.js'))
    report.problems.push(`${manifest.name}: dist/index.js missing; run npm run build:packages`);
  if (!files.includes('dist/index.d.ts')) report.problems.push(`${manifest.name}: dist/index.d.ts missing`);
  for (const file of unexpected) report.problems.push(`${manifest.name}: unexpected file ${file}`);
  report.packages[manifest.name] = { files: files.length };
}
const rootFiles = run(root);
const leaked = rootFiles.filter((file) => phase2.some((name) => file.startsWith(`packages/${name}/`)));
for (const file of leaked) report.problems.push(`root package ships phase-two workspace file ${file}`);
const rootManifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const banned of ['esbuild', 'typescript', 'vite', 'prettier'])
  if (rootManifest.dependencies?.[banned]) report.problems.push(`root dependencies include build tool ${banned}`);
for (const name of Object.keys(rootManifest.dependencies || {}))
  if (name.startsWith('@types/')) report.problems.push(`root dependencies include type package ${name}`);
report.root = { files: rootFiles.length };
if (report.problems.length) report.status = 'fail';
console.log(process.argv.includes('--json') ? JSON.stringify(report, null, 2) : JSON.stringify(report));
if (report.problems.length) process.exitCode = 1;
