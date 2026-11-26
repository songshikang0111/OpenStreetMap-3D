// Sparse OSM node IDs span billions. Group by ID range, and store coordinates densely inside each populated
// range. This avoids a Map entry and a JS coordinate object per node while permitting unsorted extracts.
const PAGE_SPAN = 65536;
class NodePage {
  used = 0;
  sorted = true;
  values = new Float64Array(12);
  append(id: number, lat: number, lon: number) {
    if (this.used === this.values.length) {
      const grown = new Float64Array(this.used * 2);
      grown.set(this.values);
      this.values = grown;
    }
    if (this.used && this.values[this.used - 3]! > id) this.sorted = false;
    this.values[this.used++] = id;
    this.values[this.used++] = lat;
    this.values[this.used++] = lon;
  }
  offset(id: number): number {
    if (!this.sorted) {
      const values = this.values;
      const order = Uint32Array.from({ length: this.used / 3 }, (_, i) => i * 3).sort(
        (a, b) => values[a]! - values[b]!,
      );
      this.values = new Float64Array(this.used);
      for (const [i, offset] of order.entries()) this.values.set(values.subarray(offset, offset + 3), i * 3);
      this.sorted = true;
    }
    let lo = 0,
      hi = this.used / 3 - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const key = this.values[mid * 3]!;
      if (key === id) return mid * 3;
      if (key < id) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }
}

export class NodeCoordinates {
  private readonly pages = new Map<number, NodePage>();
  size = 0;
  add(id: number, lat: number, lon: number) {
    const index = Math.floor(id / PAGE_SPAN);
    let page = this.pages.get(index);
    if (!page) {
      page = new NodePage();
      this.pages.set(index, page);
    }
    page.append(id, lat, lon);
    this.size++;
  }
  /** Writes into a reusable point so looking up rejected ways has no per-vertex allocations. */
  get(id: number, point: { lat: number; lon: number }): boolean {
    const page = this.pages.get(Math.floor(id / PAGE_SPAN));
    const offset = page?.offset(id) ?? -1;
    if (!page || offset < 0) return false;
    point.lat = page.values[offset + 1]!;
    point.lon = page.values[offset + 2]!;
    return true;
  }
}
