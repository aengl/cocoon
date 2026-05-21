/**
 * Headless capture of the control-surfaces mockup → PNG.
 *
 *   node mockups/control-surfaces/capture.ts
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const VIEWPORT = { width: 990, height: 500 };

const vite = spawn(
  join(repoRoot, 'node_modules', '.bin', 'vite'),
  ['--port', '5181'],
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

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(`${baseUrl}/mockups/control-surfaces/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const out = join(here, 'control-surfaces.png');
  await page.screenshot({ path: out });
  console.error(`captured → ${out}`);
} finally {
  await browser.close();
  vite.kill('SIGTERM');
}
