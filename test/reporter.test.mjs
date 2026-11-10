import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

const vitestBin = join(import.meta.dirname, "../node_modules/vitest/vitest.mjs");

// Runs the demo suite (only the hero file: 22 tests, 3 of them failing) with the reporter attached.
function runDemo(onUrl) {
  const out = join(mkdtempSync(join(tmpdir(), "vitest-viz-")), "replay.html");
  const child = spawn(process.execPath, [vitestBin, "run", "--config", "demo/vitest.config.mjs", "hero"], {
    cwd: join(import.meta.dirname, ".."),
    env: { ...process.env, DEMO_PORT: "0", DEMO_OUT: out },
  });
  let stdout = "";
  let notified = false;
  const hooks = [];
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    const url = stdout.match(/live at (http:\/\/\S+)/)?.[1];
    if (url && !notified && onUrl) {
      notified = true;
      hooks.push(onUrl(url));
    }
  });
  return new Promise((resolve) =>
    child.on("close", async (code) => {
      await Promise.all(hooks);
      resolve({ code, stdout, out });
    }),
  );
}

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers }, (res) => {
      let body = "";
      res.on("data", (c) => {
        body += c;
        if (url.endsWith("/events")) {
          res.destroy(); // the stream never ends: the first chunk is enough
          resolve({ status: res.statusCode, body });
        }
      });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("records every test and writes a self-contained replay", async () => {
  const { code, out } = await runDemo();
  expect(code).toBe(1); // hero has failing tests, and the reporter must not change the exit code
  const html = readFileSync(out, "utf8");
  const data = JSON.parse(html.match(/const DATA = (.*);\nconst MAXROWS/)[1]);
  expect(data.files).toHaveLength(1);
  expect(data.files[0]).toMatchObject({ name: "hero.test.mjs", count: 22 });
  expect(data.events).toHaveLength(22);
  const failed = data.events.filter((e) => e.s === "f");
  expect(failed).toHaveLength(3);
  expect(failed[0].e).toMatch(/expected/);
  expect(data.events.every((e, i, all) => i === 0 || e.t >= all[i - 1].t)).toBe(true);
  // durations feed the Slowest panel: the demo tests sleep at least 30 ms each
  expect(data.events.every((e) => e.d >= 30)).toBe(true);
  expect(data.files[0].d).toBeGreaterThan(0);
});

test("serves the page and an event stream while the run is going", async () => {
  const seen = {};
  await runDemo(async (url) => {
    seen.page = await get(url);
    seen.events = await get(`${url}events`);
    // a page that isn't addressed to this machine (DNS rebinding) gets nothing
    seen.foreign = await get(url, { host: "evil.example" });
  });
  expect(seen.page.status).toBe(200);
  expect(seen.page.body).toContain("<canvas");
  expect(seen.events.body).toContain('"type":"reset"');
  expect(seen.foreign.status).toBe(403);
});
