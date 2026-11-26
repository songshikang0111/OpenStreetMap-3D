// Resolve group membership before phase one removes outlines already represented by parts.
import clipping from 'polygon-clipping';
import { phase1IdToFeatureId } from '@city-ink/generators';
import type { Phase1Building } from '../../../src/phase1-types.js';

interface Member {
  type: string;
  ref: number;
  role: string;
}

export function assignBuildingRelations(buildings: Phase1Building[], elements: unknown[]) {
  const memberships = new Map<string, { parent: string; role: 'part' | 'outline' } | null>();
  for (const raw of elements) {
    const relation = raw as { type: string; id: number; tags?: Record<string, string>; members?: Member[] };
    if (relation.type !== 'relation' || relation.tags?.type !== 'building') continue;
    const parent = `relation/${relation.id}`;
    for (const member of relation.members ?? []) {
      if (member.type === 'node' || (member.role !== 'part' && member.role !== 'outline')) continue;
      const id = `${member.type}/${member.ref}`;
      const previous = memberships.get(id);
      if (previous === undefined) memberships.set(id, { parent, role: member.role });
      else if (previous?.parent !== parent || previous.role !== member.role) memberships.set(id, null);
    }
  }
  const unresolved: Phase1Building[] = [];
  const outlines: Phase1Building[] = [];
  for (const building of buildings) {
    const key = `${building.osmType}/${building.osmId}`;
    if (!memberships.has(key)) {
      if (building.part) unresolved.push(building);
      else outlines.push(building);
      continue;
    }
    const membership = memberships.get(`${building.osmType}/${building.osmId}`);
    if (!membership) continue;
    building.compoundRole = membership.role;
    building.compoundId = membership.parent;
    building.membershipSource = 'observed';
    if (membership.role === 'outline') outlines.push(building);
  }

  if (!unresolved.length || !outlines.length) return;
  const indexed = (building: Phase1Building) => {
    let left = Infinity,
      right = -Infinity,
      top = Infinity,
      bottom = -Infinity;
    for (const [x, y] of building.outer) {
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    return { building, left, right, top, bottom };
  };
  // Sweep by the part's left edge: polygon differences only run on candidates with enclosing bounds.
  const parents = outlines.map(indexed).sort((a, b) => a.left - b.left);
  const parts = unresolved.map(indexed).sort((a, b) => a.left - b.left);
  const active = new Set<(typeof parents)[number]>();
  let next = 0;
  for (const part of parts) {
    while (next < parents.length && parents[next]!.left <= part.left) active.add(parents[next++]!);
    let unique: Phase1Building | undefined;
    for (const p of active) {
      if (p.right < part.left) {
        active.delete(p);
        continue;
      }
      if (p.right < part.right || p.top > part.top || p.bottom < part.bottom) continue;
      if (
        clipping.difference([part.building.outer, ...part.building.holes], [p.building.outer, ...p.building.holes])
          .length
      )
        continue;
      if (unique) {
        unique = undefined;
        break;
      }
      unique = p.building;
    }
    if (!unique) continue;
    const parent = typeof unique.compoundId === 'string' ? unique.compoundId : phase1IdToFeatureId(unique.id);
    unique.compoundId = parent;
    unique.compoundRole = 'outline';
    part.building.compoundId = parent;
    part.building.compoundRole = 'part';
    part.building.membershipSource = 'derived';
  }
}
