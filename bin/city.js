#!/usr/bin/env node
import { runCLI, exitCode } from '../src/cli/index.js';
const controller=new AbortController();
process.once('SIGINT',()=>controller.abort(new DOMException('Interrupted','AbortError')));
process.once('SIGTERM',()=>controller.abort(new DOMException('Terminated','AbortError')));
const result=await runCLI(process.argv.slice(2),{signal:controller.signal});
process.exitCode=exitCode(result);
