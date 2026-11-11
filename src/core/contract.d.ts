export function normalizeRaw(
  raw: unknown,
  config: { area: { south: number; west: number; north: number; east: number }; origin: { lat: number; lon: number } },
): { metadata: Record<string, unknown>; elements: unknown[]; [key: string]: unknown };
export function canonicalStringify(value: unknown): string;
