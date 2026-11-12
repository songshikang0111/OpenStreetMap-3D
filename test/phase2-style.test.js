// WP-G StyleSpec tests: AC702 (05 example validates), AC703 (strict rejection with paths), AC705 (rule expressions),
// defaults and inheritance.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  validateStyleSpec,
  resolveStyleSpec,
  evaluateExpression,
  roleStyle,
  ruleRoleApplies,
} from '../packages/styles/spec.js';
import { BUILTIN_STYLE_SPECS, builtinStyle } from '../packages/styles/defaults.js';

const example = JSON.parse(
  readFileSync(new URL('../examples/phase2/styles/spec-example.json', import.meta.url), 'utf8'),
);

test('AC702: the 05 section 4 example and the three default styles validate', () => {
  assert.deepEqual(validateStyleSpec(example), { valid: true, errors: [] });
  for (const spec of Object.values(BUILTIN_STYLE_SPECS)) assert.equal(validateStyleSpec(spec).valid, true, spec.id);
  const r = builtinStyle('dark');
  assert.equal(r.facade.nightLights, true);
  assert.equal(r.environment.shadows, true);
});

test('AC703: unknown fields, wrong types, bad colours and unsupported expressions are rejected with a path', () => {
  const cases = [
    [{ ...example, colour: '#fff' }, '$.colour'],
    [{ ...example, roles: { wall: { color: 'red' } } }, '$.roles.wall.color'],
    [{ ...example, roles: { wall: { color: '#12345g' } } }, '$.roles.wall.color'],
    [{ ...example, roles: { wall: { roughness: '0.5' } } }, '$.roles.wall.roughness'],
    [{ ...example, roles: { tower: { color: '#ffffff' } } }, '$.roles.tower'],
    [{ ...example, environment: { sun: { altitude: 120 } } }, '$.environment.sun.altitude'],
    [{ ...example, environment: { shadows: 'yes' } }, '$.environment.shadows'],
    [{ ...example, facade: { windows: 1 } }, '$.facade.windows'],
    [
      { ...example, rules: [{ layer: 'building', when: ['regex', ['get', 'name'], 'x'], set: { wall: {} } }] },
      '$.rules[0].when[0]',
    ],
    [
      { ...example, rules: [{ layer: 'building', when: ['get'], set: { wall: { color: '#fff' } } }] },
      '$.rules[0].when',
    ],
    [
      { ...example, rules: [{ layer: 'building', when: true, set: { wall: { roughness: 1 } } }] },
      '$.rules[0].set.wall.roughness',
    ],
    [{ ...example, schemaVersion: 1 }, '$.schemaVersion'],
    [{ ...example, extends: 'comic' }, '$.extends'],
    [{ ...example, featureState: { highlight: { emissive: 'orange' } } }, '$.featureState.highlight.emissive'],
  ];
  for (const [spec, path] of cases) {
    const r = validateStyleSpec(spec);
    assert.equal(r.valid, false, path);
    assert.ok(
      r.errors.some((e) => e.path === path),
      `${path}: ${JSON.stringify(r.errors)}`,
    );
  }
});

test('AC705: the two 05 example rules match by provenance and by attribute', () => {
  const [byProvenance, byHeight] = example.rules;
  const inferred = { properties: { height: 30 }, provenance: { height: 'inferred' } };
  const observedTall = { properties: { height: 220 }, provenance: { height: 'observed' } };
  assert.equal(evaluateExpression(byProvenance.when, inferred), true);
  assert.equal(evaluateExpression(byProvenance.when, observedTall), false);
  assert.equal(evaluateExpression(byHeight.when, observedTall), true);
  assert.equal(evaluateExpression(byHeight.when, inferred), false);
  const f = { properties: { usage: 'office', height: 12 }, provenance: { height: 'derived' } };
  assert.equal(evaluateExpression(['in', ['get', 'usage'], ['office', 'retail']], f), true);
  assert.equal(
    evaluateExpression(['all', ['>=', ['get', 'height'], 10], ['!', ['==', ['provenance', 'height'], 'inferred']]], f),
    true,
  );
  assert.equal(evaluateExpression(['any', ['<', ['get', 'height'], 5], ['!=', ['get', 'usage'], 'office']], f), false);
  assert.equal(evaluateExpression(['>', ['get', 'missing'], 3], f), false);
  assert.ok(
    ruleRoleApplies('wall', 'glass') && ruleRoleApplies('road', 'road.marking') && !ruleRoleApplies('road', 'roof'),
  );
});

test('extends merges roles per field, concatenates rules and sub-roles fall back to parents', () => {
  const child = {
    schemaVersion: 2,
    id: 'brand',
    extends: 'light',
    roles: { wall: { color: '#ff0000' } },
    rules: example.rules,
  };
  assert.equal(validateStyleSpec(child).valid, true);
  const r = resolveStyleSpec(child, BUILTIN_STYLE_SPECS);
  assert.equal(r.roles.wall.color, '#ff0000');
  assert.equal(r.roles.wall.blend, 'multiply');
  assert.equal(r.roles.water.color, BUILTIN_STYLE_SPECS.light.roles.water.color);
  assert.equal(r.rules.length, 2);
  assert.equal(roleStyle(r, 'road.motorway').color, BUILTIN_STYLE_SPECS.light.roles.road.color);
  assert.equal(roleStyle(r, 'road.marking').color, BUILTIN_STYLE_SPECS.light.roles['road.marking'].color);
});

test('AC707/AC708: ink looks come from @city-ink/styles-ink; createMap code never imports it', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const dir = new URL('../packages/map/dist/', import.meta.url).pathname;
  const files = [];
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true }))
      if (e.isDirectory()) await walk(path.join(d, e.name));
      else if (e.name.endsWith('.js')) files.push(path.join(d, e.name));
  };
  await walk(dir);
  for (const f of files) {
    const text = await readFile(f, 'utf8');
    assert.doesNotMatch(text, /(from|import\()\s*['"][^'"]*(styles-ink|ink-renderer|halftone)/, f);
  }
  const { resolveStyle } = await import('../packages/map/dist/styles.js');
  const ink = await import('../packages/styles-ink/dist/index.js');
  assert.equal(resolveStyle(ink.comic).pack.id, 'comic');
  assert.throws(
    () => resolveStyle(ink.comic, true),
    (e) => e.code === 'STYLE_NOT_HOST_COMPATIBLE',
  );
  assert.equal(resolveStyle(ink.cel, true).pack.id, 'external-cel');
  const { officialStyles } = await import('../packages/styles/index.js');
  assert.throws(
    () => resolveStyle(officialStyles[0]),
    (e) => e.code === 'STYLE_UNSUPPORTED',
  );
  assert.throws(
    () => resolveStyle({ schemaVersion: 2, id: 'x', roles: { wall: { color: 'red' } } }),
    (e) => e.code === 'STYLE_INVALID' && e.errors[0].path === '$.roles.wall.color',
  );
  // phase-one ids keep working in the root SDK registry
  const root = await import('../src/styles/index.js');
  for (const id of ['comic', 'line', 'color', 'white']) assert.ok(root.getStyle(id), id);
});
