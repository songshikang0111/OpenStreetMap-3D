// Shared real-browser harness for phase-two checks (Chrome/Edge via CDP, loopback static server).
// Screenshots and frame logs are written outside the repository (07 section 4).
import { writeFile } from 'node:fs/promises';
import { openLocalBrowser } from '../../src/cli/browser-session.js';

export async function openPage(root, startPath, { width = 1280, height = 720, headless = true } = {}) {
  const session = await openLocalBrowser({ root, startPath, width, height, headless });
  const evaluate = async (expression, { awaitPromise = true, timeout = 120000 } = {}) => {
    const r = await session.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expression, timeoutMs = 60000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(expression)) return true;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Timed out waiting for ${expression}`);
  };
  const screenshot = async (file) => {
    const r = await session.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(file, Buffer.from(r.data, 'base64'));
  };
  const version = await session.send('Browser.getVersion').catch(() => ({}));
  return { ...session, evaluate, waitFor, screenshot, version };
}
