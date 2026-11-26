export interface FacadeAttributes {
  style: number;
  variant: number;
  layout: number[];
  surface: number[];
}

// Oriented triangle soup from the shared building writer. Blocks keep only the float32 attributes the tile
// actually returns. Their exact-size views are copied once when direct indexed vertices and runs are combined.
export class FaceBlock {
  readonly capacity = 1536; // whole triangles
  count = 0;
  readonly positions = new Float32Array(this.capacity * 3);
  readonly normals = new Float32Array(this.capacity * 3);
  readonly colors = new Float32Array(this.capacity * 3);
  readonly renderIds = new Float32Array(this.capacity);
  readonly roles = new Float32Array(this.capacity);
  readonly facades = new Float32Array(this.capacity * 4);
  readonly styles = new Float32Array(this.capacity * 2);
  readonly layouts = new Float32Array(this.capacity * 4);
  readonly surfaces = new Float32Array(this.capacity * 2);

  write(
    a: number[],
    b: number[],
    c: number[],
    normal: number[],
    color: { r: number; g: number; b: number },
    id: number,
    role: number,
    yOffset: number,
    uv: number[][] | null,
    attributes: FacadeAttributes,
  ) {
    const { style, variant, layout, surface } = attributes;
    const start = this.count;
    for (let k = 0; k < 3; k++) {
      const i = start + k,
        p = k === 0 ? a : k === 1 ? b : c;
      this.positions[i * 3] = p[0]!;
      this.positions[i * 3 + 1] = p[1]! - yOffset;
      this.positions[i * 3 + 2] = p[2]!;
      this.normals[i * 3] = normal[0]!;
      this.normals[i * 3 + 1] = normal[1]!;
      this.normals[i * 3 + 2] = normal[2]!;
      this.colors[i * 3] = color.r;
      this.colors[i * 3 + 1] = color.g;
      this.colors[i * 3 + 2] = color.b;
      this.renderIds[i] = id;
      this.roles[i] = role;
      if (uv) this.facades.set(uv[k]!, i * 4);
      this.styles[i * 2] = style;
      this.styles[i * 2 + 1] = variant;
      this.layouts[i * 4] = layout[0]!;
      this.layouts[i * 4 + 1] = layout[1]!;
      this.layouts[i * 4 + 2] = layout[2]!;
      this.layouts[i * 4 + 3] = layout[3]!;
      this.surfaces[i * 2] = surface[0]!;
      this.surfaces[i * 2 + 1] = surface[1]!;
    }
    this.count += 3;
  }
}
