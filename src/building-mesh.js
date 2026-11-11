import * as THREE from 'three';
import { inside } from './osm.js';
import { buildingStyle, roofEquipment } from './building-rules.js';
import { MeshWriter, normalizedRing, polygon, addBox } from './generators/mesh-tools.js';
import { facadeLayout } from './facade-layout.js';
import { writeRoof } from './roofs.js';

/**
 * Writes one ordinary (non-landmark) building: facade walls, trims, roof, underside, entrance and roof equipment.
 * Shared by the phase-one scene path (src/city.js) and the phase-two tile generators so that both produce the same
 * geometry from the same planned inputs. Counters are accumulated into `counts`.
 */
export function writeBuildingBody(
  building,
  { renderId, seed = 1, roofPlan, envelopePlan, roofWriter = new MeshWriter(), counts = {} },
) {
  const familyCounts = (counts.familyCounts ||= {}),
    surfaceCounts = (counts.surfaceCounts ||= {}),
    grammarCounts = (counts.grammarCounts ||= {}),
    roofStats = (counts.roofStats ||= { tagged: 0, inferred: 0, unsupported: 0 }),
    nearWalls = (counts.nearWalls ||= []),
    roofDetails = (counts.roofDetails ||= []);
  const writer = new MeshWriter(),
    id = renderId,
    style = buildingStyle(building, seed || 1);
  writer.style = style.code;
  writer.variant = style.variant;
  familyCounts[style.family] = (familyCounts[style.family] || 0) + 1;
  writer.surface = [style.surface, style.surfaceScale];
  surfaceCounts[style.surfaceName] = (surfaceCounts[style.surfaceName] || 0) + 1;
  const roof = roofPlan,
    bodyHeight = roof.supported ? roof.eave - 0.45 : building.height;
  const wall = new THREE.Color(style.color),
    floorHeight = style.floor,
    baseY = 0.45 + building.minHeight,
    topY = 0.45 + bodyHeight;
  building.roofModel = {
    shape: roof.shape,
    source: roof.source,
    supported: roof.supported,
    dimensionsInferred: roof.dimensionsInferred || false,
  };
  if (roof.supported) roofStats[roof.source === 'osm' ? 'tagged' : 'inferred']++;
  else if (roof.source === 'osm' && roof.shape !== 'flat') roofStats.unsupported++;
  const trim = style.family === 'curtain' ? '#c9d5d7' : '#e5e1d6';
  let profile = null;
  {
    const envelope = envelopePlan;
    const rings = [normalizedRing(building.outer), ...building.holes.map((h) => normalizedRing(h, true))];
    let longest = null,
      grammarName = null;
    for (const [ringIndex, ring] of rings.entries())
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          b = ring[(i + 1) % ring.length],
          dx = b[0] - a[0],
          dz = b[1] - a[1],
          len = Math.hypot(dx, dz);
        if (len < 0.03) continue;
        const normal = [dz / len, 0, -dx / len],
          angle = Math.atan2(-dz, dx),
          mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const layout = facadeLayout(len, topY - baseY, style);
        writer.layout = layout.attributes;
        grammarName = layout.name;
        const spans = envelope.wall(a, b, normal);
        for (const span of spans) {
          const sa = [a[0] + dx * span.t0, a[1] + dz * span.t0],
            sb = [a[0] + dx * span.t1, a[1] + dz * span.t1];
          const low = 0.45 + span.lo,
            high = 0.45 + span.hi,
            spanLen = len * (span.t1 - span.t0),
            sm = [(sa[0] + sb[0]) / 2, (sa[1] + sb[1]) / 2];
          writer.quad(
            [
              [sa[0], low, sa[1]],
              [sb[0], low, sb[1]],
              [sb[0], high, sb[1]],
              [sa[0], high, sa[1]],
            ],
            normal,
            wall,
            id,
            [
              [len * span.t0, low - baseY, len, floorHeight],
              [len * span.t1, low - baseY, len, floorHeight],
              [len * span.t1, high - baseY, len, floorHeight],
              [len * span.t0, high - baseY, len, floorHeight],
            ],
          );
          // Near-ties (within 10 cm) keep the first wall, so centimetre-level coordinate quantisation in tiles
          // cannot move the entrance to another facade.
          if (!ringIndex && span.lo === 0 && (!longest || spanLen > longest.len + 0.1))
            longest = { a: sa, b: sb, len: spanLen, normal, angle, mid: sm, dx: sb[0] - sa[0], dz: sb[1] - sa[1] };
          // Trim follows the exposed wall, never a buried podium/tower seam.
          if (spanLen > 2 && building.height > 6) {
            if (span.hi === bodyHeight && !roof.supported) {
              addBox(
                writer,
                [sm[0] - normal[0] * 0.35, topY + 0.32, sm[1] - normal[2] * 0.35],
                [spanLen, 0.65, 0.5],
                trim,
                id,
                angle,
              );
              if (style.family === 'curtain' && building.height > 60 && topY - 4 > low)
                addBox(
                  writer,
                  [sm[0] + normal[0] * 0.12, topY - 4, sm[1] + normal[2] * 0.12],
                  [spanLen, 0.24, 0.25],
                  trim,
                  id,
                  angle,
                );
            }
            if (style.family === 'curtain' && building.height > 60 && len > 12)
              for (let column = layout.group; column < layout.bays; column += layout.group) {
                const u = column / layout.bays;
                if (u <= span.t0 || u >= span.t1) continue;
                addBox(
                  writer,
                  [a[0] + dx * u + normal[0] * 0.2, (low + high) / 2, a[1] + dz * u + normal[2] * 0.2],
                  [0.3, high - low, 0.8],
                  trim,
                  id,
                  angle,
                );
              }
            if (style.family === 'ribbon')
              for (let y = baseY + floorHeight; y < high - 0.5; y += floorHeight)
                if (y > low + 0.2) {
                  addBox(
                    writer,
                    [sm[0] + normal[0] * 0.22, y, sm[1] + normal[2] * 0.22],
                    [spanLen, 0.3, 0.7],
                    trim,
                    id,
                    angle,
                  );
                }
          }
        }
        // Fine frame grammar is valid on a complete original wall only.
        // Clipped partial walls keep the same shader panes without stray frames.
        if (
          !ringIndex &&
          len > 7 &&
          spans.length === 1 &&
          spans[0].t0 === 0 &&
          spans[0].t1 === 1 &&
          spans[0].lo === building.minHeight &&
          spans[0].hi === bodyHeight
        )
          nearWalls.push({ key: `${building.id}:${i}`, a, dx, dz, len, normal, angle, layout, baseY, style });
      }
    grammarCounts[grammarName] = (grammarCounts[grammarName] || 0) + 1;
    writer.style = 0;
    writer.materialRole = 'roof';
    if (roof.supported) {
      const rawColor = building.tags['roof:colour'] || building.tags['roof:color'];
      const roofColor =
        rawColor &&
        (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(rawColor) || THREE.Color.NAMES[rawColor.toLowerCase()] !== undefined)
          ? rawColor
          : '#a5a8a0';
      writeRoof(writer, building, roof, roofColor, id, wall);
    } else for (const [outer, ...holes] of envelope.roof) polygon(writer, { outer, holes }, topY, '#e1e3dd', id);
    writer.materialRole = null;
    if (building.minHeight > 0) {
      const start = writer.positions.length;
      for (const [outer, ...holes] of envelope.bottom) polygon(writer, { outer, holes }, baseY, wall, id);
      for (let i = start; i < writer.positions.length; i += 9) {
        for (let c = 0; c < 3; c++)
          [writer.positions[i + 3 + c], writer.positions[i + 6 + c]] = [
            writer.positions[i + 6 + c],
            writer.positions[i + 3 + c],
          ];
        for (let c = 0; c < 3; c++) writer.normals[i + c * 3 + 1] = -1;
      }
    }
    if (longest && building.minHeight === 0 && building.height > 10 && longest.len > 12) {
      const { mid, normal, angle, len } = longest,
        w = Math.min(len * 0.28, 11),
        x = mid[0] + normal[0] * 0.32,
        z = mid[1] + normal[2] * 0.32;
      addBox(writer, [x, baseY + 2.15, z], [w, 4.3, 0.35], '#637b86', id, angle);
      addBox(writer, [x + normal[0] * 1, baseY + 4.4, z + normal[2] * 1], [w + 2, 0.28, 2.6], trim, id, angle);
      addBox(writer, [x, baseY + 2.15, z], [0.16, 4.3, 0.48], trim, id, angle);
    }
    for (const box of roof.supported ? [] : roofEquipment(building)) {
      if (
        !envelope.roof.some(
          ([outer, ...holes]) => inside([box.x, box.z], outer) && !holes.some((h) => inside([box.x, box.z], h)),
        )
      )
        continue;
      const start = roofWriter.positions.length;
      addBox(roofWriter, [box.x, topY + box.h / 2, box.z], [box.w, box.h, box.d], '#aeb7b4', id);
      addBox(roofWriter, [box.x, topY + box.h + 0.1, box.z], [box.w + 0.3, 0.2, box.d + 0.3], '#d6dbd8', id);
      for (let j = 0; j < 3; j++)
        addBox(
          roofWriter,
          [box.x - box.w * 0.3 + j * box.w * 0.3, topY + box.h + 0.23, box.z],
          [0.18, 0.14, box.d * 0.8],
          '#6b7e7c',
          id,
        );
      roofDetails.push({
        start,
        end: roofWriter.positions.length,
        anchor: [box.x, topY, box.z],
        size: Math.max(box.w, box.d),
        weight: 1,
      });
    }
  }
  return { writer, style, profile, roofWriter };
}
