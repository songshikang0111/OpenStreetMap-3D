// Distinct owner filenames let overlapping writers detect one another without racing to replace a shared lock.
// A killed local process leaves a PID marker that the next build can reclaim.
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import path from 'node:path';

export async function ownOutput(out: string) {
  await mkdir(out, { recursive: true });
  const host = createHash('sha256').update(hostname()).digest('hex').slice(0, 16);
  const name = `.city-build-${host}-${process.pid}-${randomUUID()}.lock`;
  const file = path.join(out, name);
  await writeFile(file, '', { flag: 'wx' });
  const release = () => rm(file, { force: true });
  try {
    for (const entry of await readdir(out)) {
      if (entry === name) continue;
      const m = /^\.city-build-([a-f0-9]{16})-(\d+)-[a-f\d-]+\.lock$/.exec(entry);
      if (!m) continue;
      if (m[1] === host) {
        try {
          process.kill(Number(m[2]), 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
            await rm(path.join(out, entry), { force: true });
            continue;
          }
        }
      }
      throw Object.assign(new Error('Another build owns this output directory.'), {
        code: 'TILES_OUTPUT_BUSY',
        hint: 'Use another output directory or retry after the running build finishes.',
      });
    }
    return release;
  } catch (error) {
    await release();
    throw error;
  }
}
