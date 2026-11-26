import { ARCHIVE_INDEX, MAX_INDEX_BYTES, TAR_BLOCK, archiveMember, paddedSize } from '@city-ink/tiles';
import type { MapOptions } from './types.js';

function invalid(reason: string): Error {
  return Object.assign(new Error(reason), { code: 'TILE_ARCHIVE_INVALID' });
}

/** Open an indexed USTAR from a static host with HTTP byte ranges. Includes signed URL query parameters on every request. */
export async function openTileArchive(
  url: string,
  signal?: AbortSignal,
): Promise<Pick<MapOptions, 'tiles' | 'readAsset'>> {
  const archive = new URL(url, globalThis.location?.href);
  const base = new URL(archive.href);
  base.pathname += '/';
  base.search = base.hash = '';
  let total: number | undefined;
  async function range(start: number, size: number, signal?: AbortSignal): Promise<ArrayBuffer> {
    const end = start + size - 1;
    const response = await fetch(archive, { headers: { Range: `bytes=${start}-${end}` }, signal });
    const expected = `bytes ${start}-${end}/`;
    const contentRange = response.headers.get('Content-Range') ?? '';
    const length = Number(contentRange.slice(expected.length));
    if (
      response.status !== 206 ||
      !contentRange.startsWith(expected) ||
      !Number.isSafeInteger(length) ||
      length <= end ||
      (total !== undefined && total !== length)
    ) {
      await response.body?.cancel();
      throw invalid('Archive host must return a consistent 206 Content-Range for ' + expected);
    }
    total = length;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== size) throw invalid('Archive range returned the wrong byte count.');
    return bytes;
  }
  const decode = new TextDecoder('utf-8', { fatal: true });
  const head = new Uint8Array(await range(0, TAR_BLOCK, signal));
  const name = decode.decode(head.subarray(0, 100)).replace(/\0+$/, '');
  const octal = decode.decode(head.subarray(124, 136)).replace(/\0+$/, '');
  const size = parseInt(octal, 8);
  if (name !== ARCHIVE_INDEX || !/^[0-7]+$/.test(octal) || !size || size > MAX_INDEX_BYTES || TAR_BLOCK + size > total!)
    throw invalid('Invalid City Ink archive index header.');
  const entries: unknown = JSON.parse(decode.decode(await range(TAR_BLOCK, size, signal)));
  if (!Array.isArray(entries)) throw invalid('Expected an array of archive members.');
  const files = new Map<string, { start: number; size: number }>();
  let offset = TAR_BLOCK + paddedSize(size);
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) throw invalid('Invalid archive member.');
    const [name, bytes] = entry;
    if (typeof name !== 'string' || !archiveMember(name) || !Number.isSafeInteger(bytes) || bytes <= 0)
      throw invalid('Invalid archive member name or size.');
    const key = new URL(name, base).href;
    if (files.has(key)) throw invalid('Duplicate archive member: ' + name);
    files.set(key, { start: offset + TAR_BLOCK, size: bytes });
    offset += TAR_BLOCK + paddedSize(bytes);
    if (offset > total!) throw invalid('Archive member points outside the file.');
  }
  if (offset + 2 * TAR_BLOCK !== total) throw invalid('Archive length differs from its index.');
  const tiles = new URL('tileset.json', base).href;
  if (!files.has(tiles)) throw invalid('Archive has no tileset.json.');
  return {
    tiles,
    async readAsset(url, { responseType, signal }) {
      const file = files.get(url);
      if (!file) throw invalid('Missing archive member: ' + url);
      const bytes = await range(file.start, file.size, signal);
      return responseType === 'json' ? JSON.parse(decode.decode(bytes)) : bytes;
    },
  };
}
