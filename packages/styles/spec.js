// StyleSpec (05 section 4): validation, inheritance and the rule expression subset. Pure data functions, no Three.js,
// usable in Node, browsers and Workers. The JSON Schema in schemas/style-spec.schema.json describes the same contract.

export const STYLE_SPEC_VERSION = 2;

/** Semantic roles (05 section 3). Sub-roles fall back to their parent at runtime. */
export const ROLES = ['wall', 'glass', 'roof', 'structure', 'road', 'water', 'foliage', 'ground', 'facility', 'landmark'];
export const SUB_ROLES = [
  'road.motorway',
  'road.primary',
  'road.minor',
  'road.footway',
  'road.marking',
  'ground.pavement',
  'ground.green',
  'ground.plaza',
  'foliage.broadleaf',
  'foliage.conifer',
  'foliage.trunk',
  'roof.flat',
  'roof.pitched',
];
export const PROVENANCE = ['observed', 'derived', 'inferred'];
export const EXPRESSION_OPERATORS = ['get', 'provenance', '==', '!=', '<', '<=', '>', '>=', 'all', 'any', '!', 'in'];

const ROLE_KEYS = ['color', 'roughness', 'metalness', 'opacity', 'reflectivity', 'emissive', 'emissiveIntensity', 'blend', 'inherit'];
const RULE_SET_KEYS = ['color', 'opacity'];
const TOP_KEYS = [
  '$schema',
  'schemaVersion',
  'id',
  'name',
  'extends',
  'environment',
  'roles',
  'facade',
  'rules',
  'featureState',
  'hostCompatible',
];
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isColor(value) {
  return typeof value === 'string' && HEX.test(value);
}

/** True for a known role or sub-role, or an unknown sub-role of a known role ("road.service" falls back to "road"). */
export function isRoleName(name) {
  if (typeof name !== 'string' || !/^[a-z]+(?:\.[a-z0-9-]+)*$/.test(name)) return false;
  return ROLES.includes(name.split('.')[0]);
}

class Errors {
  list = [];
  add(path, message) {
    this.list.push({ path, message });
  }
}

function checkObject(value, path, keys, errors) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    errors.add(path, 'must be an object');
    return false;
  }
  for (const k of Object.keys(value)) if (!keys.includes(k)) errors.add(`${path}.${k}`, 'unknown field');
  return true;
}
function checkNumber(value, path, errors, min = -Infinity, max = Infinity) {
  if (typeof value !== 'number' || !Number.isFinite(value)) errors.add(path, 'must be a finite number');
  else if (value < min || value > max) errors.add(path, `must be between ${min} and ${max}`);
}
function checkBoolean(value, path, errors) {
  if (typeof value !== 'boolean') errors.add(path, 'must be a boolean');
}
function checkColor(value, path, errors) {
  if (!isColor(value)) errors.add(path, 'must be a colour "#rgb" or "#rrggbb"');
}

/** Validates one expression of the rule subset; returns nothing, records errors with their path. */
export function checkExpression(expr, path, errors) {
  if (!Array.isArray(expr)) {
    if (['string', 'number', 'boolean'].includes(typeof expr) || expr === null) return;
    errors.add(path, 'must be a literal or an expression array');
    return;
  }
  const [op, ...args] = expr;
  if (!EXPRESSION_OPERATORS.includes(op)) {
    errors.add(`${path}[0]`, `unsupported expression "${String(op)}"; use one of ${EXPRESSION_OPERATORS.join(', ')}`);
    return;
  }
  const arity = (n) => args.length === n || errors.add(path, `"${op}" takes ${n} argument${n === 1 ? '' : 's'}`);
  if (op === 'get' || op === 'provenance') {
    arity(1);
    if (typeof args[0] !== 'string') errors.add(`${path}[1]`, 'must be an attribute name');
    return;
  }
  if (op === '!') {
    arity(1);
    checkExpression(args[0], `${path}[1]`, errors);
    return;
  }
  if (op === 'all' || op === 'any') {
    if (!args.length) errors.add(path, `"${op}" needs at least one argument`);
    args.forEach((a, i) => checkExpression(a, `${path}[${i + 1}]`, errors));
    return;
  }
  if (op === 'in') {
    arity(2);
    checkExpression(args[0], `${path}[1]`, errors);
    if (!Array.isArray(args[1]) || args[1].some((v) => Array.isArray(v) || (v !== null && typeof v === 'object')))
      errors.add(`${path}[2]`, 'must be an array of literal values');
    return;
  }
  arity(2);
  args.forEach((a, i) => checkExpression(a, `${path}[${i + 1}]`, errors));
}

function checkRole(value, path, errors, keys = ROLE_KEYS) {
  if (!checkObject(value, path, keys, errors)) return;
  for (const [k, v] of Object.entries(value)) {
    const p = `${path}.${k}`;
    if (k === 'color' || k === 'emissive') checkColor(v, p, errors);
    else if (k === 'opacity' || k === 'roughness' || k === 'metalness' || k === 'reflectivity') checkNumber(v, p, errors, 0, 1);
    else if (k === 'emissiveIntensity') checkNumber(v, p, errors, 0, 10);
    else if (k === 'inherit') checkBoolean(v, p, errors);
    else if (k === 'blend' && v !== 'replace' && v !== 'multiply') errors.add(p, 'must be "replace" or "multiply"');
  }
}

/**
 * Strict validation (unknown fields, wrong types, bad colours and unsupported expressions are errors with a path).
 * `builtins` lists the style ids `extends` may reference.
 */
export function validateStyleSpec(spec, { builtins = Object.keys(BUILTIN_IDS) } = {}) {
  const errors = new Errors();
  if (!checkObject(spec, '$', TOP_KEYS, errors)) return { valid: false, errors: errors.list };
  if (spec.schemaVersion !== STYLE_SPEC_VERSION)
    errors.add('$.schemaVersion', `must be ${STYLE_SPEC_VERSION} (StyleSpec); phase-one style packs are code, not JSON`);
  if (typeof spec.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(spec.id))
    errors.add('$.id', 'must be a lower-case id (letters, digits, dashes)');
  if (spec.name !== undefined && typeof spec.name !== 'string') errors.add('$.name', 'must be a string');
  if (spec.extends !== undefined && spec.extends !== null && !builtins.includes(spec.extends))
    errors.add('$.extends', `must be null or one of ${builtins.join(', ')}`);
  if (spec.hostCompatible !== undefined) checkBoolean(spec.hostCompatible, '$.hostCompatible', errors);
  const env = spec.environment;
  if (env !== undefined && checkObject(env, '$.environment', ['background', 'fog', 'sun', 'ambient', 'shadows', 'ambientOcclusion'], errors)) {
    if (env.background !== undefined) checkColor(env.background, '$.environment.background', errors);
    if (env.fog !== undefined && env.fog !== null && checkObject(env.fog, '$.environment.fog', ['color', 'start', 'end'], errors)) {
      if (env.fog.color !== undefined) checkColor(env.fog.color, '$.environment.fog.color', errors);
      if (env.fog.start !== undefined) checkNumber(env.fog.start, '$.environment.fog.start', errors, 0, 2);
      if (env.fog.end !== undefined) checkNumber(env.fog.end, '$.environment.fog.end', errors, 0, 2);
      if (typeof env.fog.start === 'number' && typeof env.fog.end === 'number' && env.fog.start >= env.fog.end)
        errors.add('$.environment.fog', 'start must be less than end');
    }
    if (env.sun !== undefined && checkObject(env.sun, '$.environment.sun', ['azimuth', 'altitude', 'color', 'intensity'], errors)) {
      if (env.sun.azimuth !== undefined) checkNumber(env.sun.azimuth, '$.environment.sun.azimuth', errors, -360, 360);
      if (env.sun.altitude !== undefined) checkNumber(env.sun.altitude, '$.environment.sun.altitude', errors, 1, 90);
      if (env.sun.color !== undefined) checkColor(env.sun.color, '$.environment.sun.color', errors);
      if (env.sun.intensity !== undefined) checkNumber(env.sun.intensity, '$.environment.sun.intensity', errors, 0, 10);
    }
    if (env.ambient !== undefined && checkObject(env.ambient, '$.environment.ambient', ['color', 'intensity', 'ground'], errors)) {
      if (env.ambient.color !== undefined) checkColor(env.ambient.color, '$.environment.ambient.color', errors);
      if (env.ambient.ground !== undefined) checkColor(env.ambient.ground, '$.environment.ambient.ground', errors);
      if (env.ambient.intensity !== undefined) checkNumber(env.ambient.intensity, '$.environment.ambient.intensity', errors, 0, 10);
    }
    if (env.shadows !== undefined) checkBoolean(env.shadows, '$.environment.shadows', errors);
    if (env.ambientOcclusion !== undefined) checkNumber(env.ambientOcclusion, '$.environment.ambientOcclusion', errors, 0, 1);
  }
  if (spec.roles !== undefined && checkObject(spec.roles, '$.roles', Object.keys(spec.roles), errors))
    for (const [role, value] of Object.entries(spec.roles)) {
      if (!isRoleName(role)) errors.add(`$.roles.${role}`, `unknown role; use ${ROLES.join(', ')} or their sub-roles`);
      else checkRole(value, `$.roles.${role}`, errors);
    }
  if (spec.facade !== undefined && checkObject(spec.facade, '$.facade', ['windows', 'density', 'nightLights'], errors)) {
    if (spec.facade.windows !== undefined) checkBoolean(spec.facade.windows, '$.facade.windows', errors);
    if (spec.facade.nightLights !== undefined) checkBoolean(spec.facade.nightLights, '$.facade.nightLights', errors);
    if (spec.facade.density !== undefined) checkNumber(spec.facade.density, '$.facade.density', errors, 0, 2);
  }
  if (spec.rules !== undefined) {
    if (!Array.isArray(spec.rules)) errors.add('$.rules', 'must be an array');
    else
      spec.rules.forEach((rule, i) => {
        const p = `$.rules[${i}]`;
        if (!checkObject(rule, p, ['layer', 'when', 'set'], errors)) return;
        if (typeof rule.layer !== 'string' || !rule.layer) errors.add(`${p}.layer`, 'must be a layer name');
        if (rule.when === undefined) errors.add(`${p}.when`, 'is required');
        else checkExpression(rule.when, `${p}.when`, errors);
        if (checkObject(rule.set, `${p}.set`, Object.keys(rule.set ?? {}), errors)) {
          if (!Object.keys(rule.set).length) errors.add(`${p}.set`, 'must set at least one role');
          for (const [role, value] of Object.entries(rule.set)) {
            if (!isRoleName(role)) errors.add(`${p}.set.${role}`, 'unknown role');
            else checkRole(value, `${p}.set.${role}`, errors, RULE_SET_KEYS);
          }
        }
      });
  }
  const fs = spec.featureState;
  if (fs !== undefined && checkObject(fs, '$.featureState', ['highlight', 'hidden'], errors)) {
    if (fs.highlight !== undefined && checkObject(fs.highlight, '$.featureState.highlight', ['emissive', 'emissiveIntensity'], errors)) {
      if (fs.highlight.emissive !== undefined) checkColor(fs.highlight.emissive, '$.featureState.highlight.emissive', errors);
      if (fs.highlight.emissiveIntensity !== undefined)
        checkNumber(fs.highlight.emissiveIntensity, '$.featureState.highlight.emissiveIntensity', errors, 0, 10);
    }
    if (fs.hidden !== undefined && checkObject(fs.hidden, '$.featureState.hidden', ['visible'], errors))
      if (fs.hidden.visible !== undefined) checkBoolean(fs.hidden.visible, '$.featureState.hidden.visible', errors);
  }
  return { valid: errors.list.length === 0, errors: errors.list };
}

/** Evaluates a rule expression against a feature { properties, provenance }. */
export function evaluateExpression(expr, feature) {
  if (!Array.isArray(expr)) return expr;
  const [op, a, b] = expr;
  const v = (x) => evaluateExpression(x, feature);
  switch (op) {
    case 'get':
      return feature.properties?.[a] ?? null;
    case 'provenance':
      return feature.provenance?.[a] ?? null;
    case '==':
      return v(a) === v(b);
    case '!=':
      return v(a) !== v(b);
    case '<':
    case '<=':
    case '>':
    case '>=': {
      const x = v(a),
        y = v(b);
      if (typeof x !== typeof y || x === null || y === null) return false;
      return op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y;
    }
    case 'all':
      return expr.slice(1).every((e) => Boolean(v(e)));
    case 'any':
      return expr.slice(1).some((e) => Boolean(v(e)));
    case '!':
      return !v(a);
    case 'in':
      return Array.isArray(b) && b.includes(v(a));
    default:
      throw new Error(`Unsupported expression ${String(op)}`);
  }
}

const BUILTIN_IDS = { plain: true, light: true, dark: true };

function merge(base, over) {
  if (over === undefined) return base;
  if (over === null || typeof over !== 'object' || Array.isArray(over) || base === null || typeof base !== 'object')
    return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v);
  return out;
}

/**
 * Resolves `extends` against `builtins` (id → spec). Roles merge per role, environment and facade per field, rules
 * concatenate (base rules first) and the result carries every field with defaults filled in.
 */
export function resolveStyleSpec(spec, builtins) {
  const chain = [];
  let cur = spec;
  const seen = new Set();
  while (cur) {
    if (seen.has(cur.id)) throw new Error(`Style ${cur.id} extends itself.`);
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.extends ? builtins[cur.extends] : null;
  }
  let out = {
    schemaVersion: STYLE_SPEC_VERSION,
    id: spec.id,
    name: spec.name ?? spec.id,
    extends: spec.extends ?? null,
    environment: {
      background: '#eef1f4',
      fog: { color: null, start: 0.6, end: 1.0 },
      sun: { azimuth: 135, altitude: 50, color: '#ffffff', intensity: 1 },
      ambient: { color: '#ffffff', ground: '#d8d4c7', intensity: 0.6 },
      shadows: true,
      ambientOcclusion: 0.35,
    },
    roles: {},
    facade: { windows: true, density: 1, nightLights: false },
    rules: [],
    featureState: { highlight: { emissive: '#ffb300', emissiveIntensity: 0.6 }, hidden: { visible: false } },
    hostCompatible: true,
  };
  for (const s of chain) {
    out = {
      ...out,
      environment: merge(out.environment, s.environment === undefined ? undefined : { ...s.environment }),
      roles: { ...out.roles, ...Object.fromEntries(Object.entries(s.roles ?? {}).map(([k, r]) => [k, { ...(out.roles[k] ?? {}), ...r }])) },
      facade: { ...out.facade, ...(s.facade ?? {}) },
      rules: [...out.rules, ...(s.rules ?? [])],
      featureState: merge(out.featureState, s.featureState),
      hostCompatible: s.hostCompatible ?? out.hostCompatible,
    };
    if (s.environment && s.environment.fog === null) out.environment.fog = null;
  }
  out.id = spec.id;
  out.name = spec.name ?? spec.id;
  out.extends = spec.extends ?? null;
  return out;
}

/** The style of a role, walking up sub-roles ("road.marking" → "road"). */
export function roleStyle(resolved, role) {
  let r = role;
  while (r) {
    if (resolved.roles[r]) return resolved.roles[r];
    const dot = r.lastIndexOf('.');
    r = dot > 0 ? r.slice(0, dot) : '';
  }
  return {};
}

/** Whether a rule's `set` key applies to a material role (sub-roles inherit; building glass counts as wall). */
export function ruleRoleApplies(key, role) {
  if (role === key || role.startsWith(`${key}.`)) return true;
  return key === 'wall' && (role === 'glass' || role.startsWith('glass.'));
}
