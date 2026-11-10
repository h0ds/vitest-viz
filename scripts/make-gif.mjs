// Records docs/demo.gif: runs the demo suite, then steps the replay page frame by frame in headless
// Playwright Chromium (its own bundled build, never the system browser) and encodes with ffmpeg.
// Needs ffmpeg on PATH.   npm run gif

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "docs/demo.gif");
const replay = join(root, ".vitest-viz/index.html");
const FPS = 20;

// 1. Make a fresh recording of the demo run (it has failing tests, so a non-zero exit is expected).
spawnSync(process.execPath, [join(root, "node_modules/vitest/vitest.mjs"), "run", "--config", "demo/vitest.config.mjs"], {
  cwd: root,
  env: { ...process.env, DEMO_PORT: "0" },
  stdio: "ignore",
});

// 2. Step the page: at each frame set the clock, render, screenshot the card.
const frames = mkdtempSync(join(tmpdir(), "vitest-viz-frames-"));
const browser = await chromium.launch(); // headless, bundled Chromium
const page = await browser.newPage({ viewport: { width: 860, height: 760 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(replay).href);
await page.addStyleTag({ content: "footer{display:none!important} body{min-height:0!important;padding:28px!important}" });
const total = await page.evaluate(() => {
  playing = false;
  return run.total;
});
const shoot = (n) => page.screenshot({ path: join(frames, `f${String(n).padStart(4, "0")}.png`), clip: { x: 0, y: 0, width: 860, height } });
const setClock = (t) => page.evaluate((t) => {
  now = t;
  render();
}, t);
// Size the frame to the tallest state: finished, with the failure detail open.
await setClock(total);
await page.evaluate(() => document.querySelector(".cell.f").click());
await page.evaluate(() => render());
const height = await page.evaluate(() => Math.ceil(document.getElementById("card").getBoundingClientRect().bottom) + 28);
await page.evaluate(() => document.querySelector(".cell.f").click()); // close it again
let n = 0;
for (let t = 0; t < total; t += 1000 / FPS) {
  await setClock(t);
  await shoot(n++);
}
await setClock(total); // land exactly on the end so the finished state shows
for (let i = 0; i < FPS; i++) await shoot(n++); // hold the finished state for a second
await page.evaluate(() => {
  document.querySelector(".cell.f").click(); // open the failure detail
  render();
});
for (let i = 0; i < FPS * 3; i++) await shoot(n++);
await browser.close();

// 3. Encode with a palette so the greens stay clean.
mkdirSync(join(root, "docs"), { recursive: true });
const filter = `fps=${FPS},scale=760:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5`;
const ff = spawnSync("ffmpeg", ["-y", "-v", "error", "-framerate", String(FPS), "-i", join(frames, "f%04d.png"), "-vf", filter, "-loop", "0", out]);
rmSync(frames, { recursive: true, force: true });
if (ff.status !== 0) {
  console.error(String(ff.stderr));
  process.exit(1);
}
console.log(`wrote ${out}`);
