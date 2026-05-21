/**
 * Record the hero scene → WebM → animated GIF.
 *
 *   node mockups/hero/capture.ts
 *
 * Output: mockups/hero/hero.gif. The README embeds this; GitHub's markdown
 * sanitizer drops <video> tags with repo-file `src` (only attachment-URL
 * video tags survive), so a palette-optimized GIF is the path that
 * autoplays + loops without further hosting.
 */
import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const VIEWPORT = { width: 900, height: 600 };
const DURATION_MS = 14_000;

// --- spawn vite ----------------------------------------------------------
const vite = spawn(
  join(repoRoot, 'node_modules', '.bin', 'vite'),
  ['--port', '5182'],
  { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] }
);

const baseUrl = await new Promise<string>((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error('vite did not become ready in 20s')),
    20_000
  );
  vite.stdout!.on('data', (chunk: Buffer) => {
    const m = chunk.toString().match(/Local:\s+(https?:\/\/\S+)/);
    if (m) {
      clearTimeout(timer);
      resolve(m[1].replace(/\/$/, ''));
    }
  });
  vite.on('exit', code =>
    reject(new Error(`vite exited with ${code} before ready`))
  );
});

// --- record -------------------------------------------------------------
const videoDir = join(here, '_recording');
await fs.mkdir(videoDir, { recursive: true });

const browser = await chromium.launch();
let webmPath: string | null = null;
try {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1, // 1× for video — 2× blows the file up
    recordVideo: { dir: videoDir, size: VIEWPORT },
  });
  const page = await ctx.newPage();
  await page.goto(`${baseUrl}/mockups/hero/`, { waitUntil: 'networkidle' });
  // The timeline is driven by onMount inside the scene; just wait it out.
  await page.waitForTimeout(DURATION_MS);
  // Close the page first to flush the video file, then the context.
  await page.close();
  webmPath = (await page.video()?.path()) ?? null;
  await ctx.close();
} finally {
  await browser.close();
  vite.kill('SIGTERM');
}

if (!webmPath) throw new Error('no video path from playwright');

// --- convert WebM → GIF ------------------------------------------------
// Two-pass palette generation keeps the GIF small + crisp.
const gifPath = join(here, 'hero.gif');
const gif = spawnSync(
  'ffmpeg',
  [
    '-y',
    '-i',
    webmPath,
    '-vf',
    'fps=15,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=full[p];[s1][p]paletteuse=dither=sierra2_4a',
    '-loop',
    '0',
    gifPath,
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] }
);
if (gif.status !== 0) throw new Error(`ffmpeg exited with ${gif.status}`);

await fs.rm(videoDir, { recursive: true, force: true });
console.error(`captured → ${gifPath}`);
