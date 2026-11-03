// Replays constructed evidence-integrity units, never browser/GPU measurements.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const output=path.join(root,'work/remediation-harness-replay');
await mkdir(output,{recursive:true});
const script=path.join(output,'dynamic-resource-retest-a929.mjs');
await copyFile(new URL('./dynamic-resource-retest-a929.mjs',import.meta.url),script);
execFileSync(process.execPath,[script],{cwd:root,stdio:'inherit',windowsHide:true});
