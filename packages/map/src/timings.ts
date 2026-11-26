// Both histories serve live getStats() calls. Keep the exact order statistics across sliding-window evictions.
export class RollingTimings {
  readonly values: number[] = [];
  private readonly sorted: number[] = [];
  constructor(private readonly capacity: number) {}

  push(value: number): void {
    if (this.values.length === this.capacity) {
      const oldest = this.values.shift()!;
      this.sorted.splice(this.lowerBound(oldest), 1);
    }
    this.values.push(value);
    this.sorted.splice(this.lowerBound(value), 0, value);
  }

  percentile(fraction: number): number | null {
    return this.sorted[Math.min(this.sorted.length - 1, Math.floor(fraction * this.sorted.length))] ?? null;
  }

  private lowerBound(value: number) {
    let begin = 0,
      end = this.sorted.length;
    while (begin < end) {
      const middle = (begin + end) >>> 1;
      if (this.sorted[middle]! < value) begin = middle + 1;
      else end = middle;
    }
    return begin;
  }
}
