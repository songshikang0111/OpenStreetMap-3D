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
