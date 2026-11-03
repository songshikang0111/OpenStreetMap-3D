import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

test('actual Studio module releases stale viewers and CSS when preview creation finishes out of order',async()=>{
  await promisify(execFile)(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL('./helpers/studio-transition-race.mjs',import.meta.url))],{cwd:fileURLToPath(new URL('../',import.meta.url))});
});

test('an old project CSS failure cannot overwrite the new project status or diagnostics',async()=>{
  await promisify(execFile)(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL('./helpers/studio-stale-failure.mjs',import.meta.url))],{cwd:fileURLToPath(new URL('../',import.meta.url))});
});

test('a delayed build preview cannot replace the status of a newer failed export',async()=>{
  await promisify(execFile)(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL('./helpers/studio-idle-job-status.mjs',import.meta.url))],{cwd:fileURLToPath(new URL('../',import.meta.url))});
});
