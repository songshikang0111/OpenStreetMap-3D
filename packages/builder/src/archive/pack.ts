import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { ARCHIVE_INDEX, MAX_INDEX_BYTES, TAR_BLOCK, archiveMember, paddedSize } from '@city-ink/tiles';

function header(name: string, size: number): Buffer {
  const out = Buffer.alloc(TAR_BLOCK);
  const octal = (value: number, width: number) => value.toString(8).padStart(width - 1, '0') + '\0';
  if (name.length > 100 || size > 0o77777777777) throw new Error('Member exceeds USTAR limits.');
  out.write(name);
  out.write(octal(0o644, 8), 100);
  out.write(octal(0, 8), 108);
  out.write(octal(0, 8), 116);
  out.write(octal(size, 12), 124);
  out.write(octal(0, 12), 136);
  out.fill(32, 148, 156);
  out.write('0', 156);
  out.write('ustar\0' + '00', 257);
  out.write(
    octal(
      out.reduce((sum, b) => sum + b, 0),
      7,
    ) + ' ',
    148,
  );
  return out;
}

/** Packs exactly the public build outputs. An interrupted write leaves the previous archive intact. */
export async function packTiles(dir: string, output: string, signal?: AbortSignal): Promise<void> {
  const root = await realpath(dir);
  async function memberFile(name: string): Promise<string> {
    if (!archiveMember(name)) throw new Error('Unexpected tileset member: ' + name);
    const file = await realpath(path.join(root, name));
    if (!file.startsWith(root + path.sep)) throw new Error('Archive member outside tile directory: ' + name);
    return file;
  }
  const reportBytes = await readFile(await memberFile('report.json'));
  const report = JSON.parse(reportBytes.toString('utf8'));
  const hashes: Record<string, string> = report.hashes;
  if (!Object.hasOwn(hashes, 'coverage.bin')) throw new Error('Build report has no coverage.bin digest.');
  const names = ['tileset.json', 'report.json', ...Object.keys(hashes).sort()];
  if (new Set(names).size !== names.length) throw new Error('Duplicate archive member.');
  const entries: [string, number][] = [];
  for (const name of names) {
    signal?.throwIfAborted();
    const file = await memberFile(name);
    if (path.resolve(output) === file) throw new Error('Archive would overwrite a tileset member.');
    const info = await stat(file);
    if (!info.isFile() || !info.size) throw new Error('Empty or missing member: ' + name);
    entries.push([name, info.size]);
  }
  const index = Buffer.from(JSON.stringify(entries));
  if (index.length > MAX_INDEX_BYTES) throw new Error('Tileset exceeds the archive index size limit.');
  const temp = output + '.' + randomUUID() + '.tmp';
  const handle = await open(temp, 'wx');
  try {
    async function member(name: string, bytes: Buffer) {
      await handle.writeFile(header(name, bytes.length));
      await handle.writeFile(bytes);
      await handle.writeFile(Buffer.alloc(paddedSize(bytes.length) - bytes.length));
    }
    await member(ARCHIVE_INDEX, index);
    for (const [name, size] of entries) {
      signal?.throwIfAborted();
      const bytes = name === 'report.json' ? reportBytes : await readFile(await memberFile(name));
      if (
        bytes.length !== size ||
        (Object.hasOwn(hashes, name) && createHash('sha256').update(bytes).digest('hex') !== hashes[name])
      )
        throw new Error('Size or digest mismatch for ' + name);
      await member(name, bytes);
    }
    await handle.writeFile(Buffer.alloc(2 * TAR_BLOCK));
    await handle.close();
    signal?.throwIfAborted();
    await rename(temp, output);
  } finally {
    await handle.close();
    await rm(temp, { force: true });
  }
}
