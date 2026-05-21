/**
 * Headless capture of the canvas-overview mockup → PNG.
 *
 * Spawns vite (so the script is one command, not "have dev running first"),
 * waits for it to print its URL, screenshots the page at the README aspect,
 * tears down.
 *
 *   node mockups/canvas-overview/capture.ts
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const VIEWPORT = { width: 1470, height: 340 };

// Spawn vite directly (bypassing pnpm) so we can SIGTERM exactly vite and
// not have to chase a pnpm wrapper process.
const vite = spawn(
  join(repoRoot, 'node_modules', '.bin', 'vite'),
  ['--port', '5180'],
  { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] }
);

const baseUrl = await new Promise<string>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('vite did not become ready in 20s')), 20_000);
  vite.stdout!.on('data', (chunk: Buffer) => {
    const s = chunk.toString();
    const m = s.match(/Local:\s+(https?:\/\/\S+)/);
    if (m) {
      clearTimeout(timer);
      resolve(m[1].replace(/\/$/, ''));
    }
  });
  vite.on('exit', code => reject(new Error(`vite exited with ${code} before ready`)));
});

const url = `${baseUrl}/mockups/canvas-overview/`;
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  // Let fitView, fonts, and the first running-node pulse frame settle.
  await page.waitForTimeout(800);

  const out = join(here, 'canvas-overview.png');
  await page.screenshot({ path: out, omitBackground: false });
  console.error(`captured → ${out}`);
} finally {
  await browser.close();
  vite.kill('SIGTERM');
}
