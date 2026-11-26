// Building trim, entrance canopies and roof plant are boxes. Keep the eight corners until final batch assembly.
import { BOX_FACES, reverseTriangle } from '../../../src/generators/mesh-tools.js';
import type { MeshBatch } from './batch.js';
import type { FacadeAttributes } from './face-block.js';

const indices = BOX_FACES.map(([a, b, c, d]) => [
  [a, b, c],
  [a, c, b],
  [a, c, d],
  [a, d, c],
]);
// Float32 record layout. Each triangle needs a separate winding bit even when its mate is degenerate.
const NORMAL = 8 * 3;
const COLOR = NORMAL + 6 * 3;
const ID = COLOR + 3;
const ROLE = ID + 1;
const STYLE = ROLE + 1;
const LAYOUT = STYLE + 2;
const SURFACE = LAYOUT + 4;
const WINDING = SURFACE + 2;
const STRIDE = WINDING + 1;

export class BoxBlock {
  readonly capacity = 128;
  count = 0;
  private readonly records = new Float32Array(this.capacity * STRIDE);
  write(
    points: number[][],
    axes: number[][],
    color: { r: number; g: number; b: number },
    id: number,
    role: number,
    yOffset: number,
    attributes: FacadeAttributes,
  ) {
    const r = this.records,
      o = this.count++ * STRIDE;
    for (let i = 0; i < 8; i++) {
      const p = points[i]!;
      r[o + 3 * i] = p[0]!;
      r[o + 3 * i + 1] = p[1]! - yOffset;
      r[o + 3 * i + 2] = p[2]!;
    }
    let mask = 0;
    for (const [f, [a, b, c, d, axis, sign]] of BOX_FACES.entries()) {
      const v = axes[axis]!,
        n = [v[0]! * sign, v[1]! * sign, v[2]! * sign];
      r.set(n, o + NORMAL + f * 3);
      if (reverseTriangle(points[a]!, points[b]!, points[c]!, n)) mask |= 1 << (2 * f);
      if (reverseTriangle(points[a]!, points[c]!, points[d]!, n)) mask |= 2 << (2 * f);
    }
    r[o + COLOR] = color.r;
    r[o + COLOR + 1] = color.g;
    r[o + COLOR + 2] = color.b;
    r[o + ID] = id;
    r[o + ROLE] = role;
    r[o + STYLE] = attributes.style;
    r[o + STYLE + 1] = attributes.variant;
    for (let i = 0; i < 4; i++) r[o + LAYOUT + i] = attributes.layout[i]!;
    r[o + SURFACE] = attributes.surface[0]!;
    r[o + SURFACE + 1] = attributes.surface[1]!;
    r[o + WINDING] = mask;
  }

  copyTo(
    v: number,
    position: Float32Array,
    normal: Float32Array,
    color: Float32Array,
    renderId: Float32Array,
    roleIndex: Float32Array,
    facade: NonNullable<MeshBatch['facade']>,
  ) {
    const data = this.records;
    for (let o = 0; o < this.count * STRIDE; o += STRIDE) {
      renderId.fill(data[o + ID]!, v, v + 36);
      roleIndex.fill(data[o + ROLE]!, v, v + 36);
      let mask = data[o + WINDING]!;
      for (let f = 0; f < 6; f++) {
        const face = indices[f]!,
          n = o + NORMAL + f * 3;
        for (let tri = 0; tri < 2; tri++) {
          const vertices = face[tri * 2 + (mask & 1)]!;
          mask >>>= 1;
          for (let j = 0; j < 3; j++, v++) {
            const p = o + vertices[j]! * 3,
              t = v * 3;
            position[t] = data[p]!;
            position[t + 1] = data[p + 1]!;
            position[t + 2] = data[p + 2]!;
            normal[t] = data[n]!;
            normal[t + 1] = data[n + 1]!;
            normal[t + 2] = data[n + 2]!;
            color[t] = data[o + COLOR]!;
            color[t + 1] = data[o + COLOR + 1]!;
            color[t + 2] = data[o + COLOR + 2]!;
            facade.aStyle[v * 2] = data[o + STYLE]!;
            facade.aStyle[v * 2 + 1] = data[o + STYLE + 1]!;
            facade.aLayout[v * 4] = data[o + LAYOUT]!;
            facade.aLayout[v * 4 + 1] = data[o + LAYOUT + 1]!;
            facade.aLayout[v * 4 + 2] = data[o + LAYOUT + 2]!;
            facade.aLayout[v * 4 + 3] = data[o + LAYOUT + 3]!;
            facade.aSurface[v * 2] = data[o + SURFACE]!;
            facade.aSurface[v * 2 + 1] = data[o + SURFACE + 1]!;
          }
        }
      }
    }
  }
}
