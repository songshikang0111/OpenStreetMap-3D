// City Ink's indexed USTAR profile. The first member is the ordered list of all subsequent public files.
export const ARCHIVE_INDEX = 'city-ink-index-v1.json';
export const TAR_BLOCK = 512;
export const MAX_INDEX_BYTES = 16 * 1024 * 1024;
export const paddedSize = (bytes: number): number => Math.ceil(bytes / TAR_BLOCK) * TAR_BLOCK;
export function archiveMember(name: string): boolean {
  return /^(?:tileset\.json|report\.json|coverage\.bin|\d+\/\d+\/\d+\.c3t)$/.test(name);
}
