import type { CityFrameRecord, CityViewerStats } from 'beijing-city-ink';
declare const stats: CityViewerStats;
const rows: CityFrameRecord[] = stats.rendering.frames ?? [];
for (const frame of rows) {
  const body: number = frame.bodyNearDetails;
  const attachments: number = frame.nearAttachmentDetails;
  const total: number = frame.totalNearDetails;
  const arrays: number = frame.nearGeometryArrayBytes;
  const interval: number | null = frame.intervalMs;
  console.log(body + attachments === total, arrays, interval);
}
const lastTotal: number | undefined = stats.rendering.last.totalNearDetails;
const first: CityFrameRecord | null | undefined = stats.rendering.initialFrame;
if(first) { const firstTotal: number = first.totalNearDetails; void firstTotal; }
void lastTotal;
