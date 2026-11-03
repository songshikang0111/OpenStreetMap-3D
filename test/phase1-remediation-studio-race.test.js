import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

test('actual Studio module releases stale viewers and CSS when preview creation finishes out of order',async()=>{
  await promisify(execFile)(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL('./helpers/studio-transition-race.mjs',import.meta.url))],{cwd:fileURLToPath(new URL('../',import.meta.url))});
});
