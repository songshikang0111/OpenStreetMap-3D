// Mapping between phase-one object ids ("w123", "r45-0") and tile feature ids ("way/123", "relation/45#0").

export function phase1IdToFeatureId(id: string): string {
  const way = /^w(\d+)$/.exec(id);
  if (way) return `way/${way[1]}`;
  const rel = /^r(\d+)-(\d+)$/.exec(id);
  if (rel) return `relation/${rel[1]}#${rel[2]}`;
  const node = /^n(\d+)$/.exec(id);
  if (node) return `node/${node[1]}`;
  throw new Error(`Unsupported phase-one id ${id}`);
}

export function featureIdToPhase1Id(id: string): string {
  const m = /^(way|relation|node)\/(\d+)(?:#(\d+))?$/.exec(id);
  if (!m) return id;
  if (m[1] === 'way') return `w${m[2]}`;
  if (m[1] === 'node') return `n${m[2]}`;
  return `r${m[2]}-${m[3] ?? 0}`;
}
