// vitest-viz: a Vitest reporter that shows a run as a live throughput graph plus one row of pass/fail
// cells per test file. It serves a page on localhost while the run is going, and writes the finished run
// to a self-contained HTML file you can open later and scrub through.
//
// No dependencies. The page is plain HTML, CSS and JS. Opening a window is opt-in and only ever uses
// Playwright's own bundled Chromium (never the system browser).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = `${here}/template.html`;
const DATA_MARKER = "/*DATA*/null";
const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

export default class VizReporter {
  /**
   * @param {import("./reporter.d.mts").VizOptions} [options]
   */
  constructor(options = {}) {
    this.outFile = options.outFile ?? ".vitest-viz/index.html";
    this.port = options.port ?? 7378;
    this.live = options.live ?? true;
    this.open = options.open ?? process.env.VITEST_VIZ === "open";
    this.title = options.title;
    /** Address of the live page once the run has started, or undefined when there is none. */
    this.url = undefined;
    this.clients = new Set();
    this.log = [];
    this.reset();
  }

  reset() {
    this.start = performance.now();
    this.files = []; // { name, count, d }
    this.index = new Map();
    this.events = []; // { t, f, s, n, d, e? }
  }

  now() {
    return Math.round(performance.now() - this.start);
  }

  send(msg) {
    this.log.push(msg);
    const line = `data: ${JSON.stringify({ ...msg, now: this.now() })}\n\n`;
    for (const res of this.clients) res.write(line);
  }

  fileIndex(module) {
    const name = relative(this.root, module.moduleId).replaceAll("\\", "/");
    let i = this.index.get(name);
    if (i === undefined) {
      i = this.files.length;
      this.index.set(name, i);
      this.files.push({ name, count: 0, d: null });
      this.send({ type: "file", f: i, name, count: 0 });
    }
    return i;
  }

  async onInit(vitest) {
    this.root = vitest.config.root;
    this.watch = vitest.config.watch;
    this.outFile = resolve(this.root, this.outFile);
    this.title ??= `vitest · ${basename(this.root)}`;
    if (!this.live) return;
    this.server = createServer((req, res) => {
      // The page lists test names and error messages: refuse anything that isn't addressed to this machine.
      if (!LOCAL_HOST.test(req.headers.host ?? "")) {
        res.writeHead(403).end();
        return;
      }
      if (req.url === "/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        for (const msg of this.log) res.write(`data: ${JSON.stringify({ ...msg, now: this.now() })}\n\n`);
        this.clients.add(res);
        req.on("close", () => this.clients.delete(res));
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(readFileSync(TEMPLATE, "utf8"));
    });
    // A busy port only costs the live page; the static replay still gets written.
    for (const port of [this.port, 0]) {
      const listening = await new Promise((done) => {
        this.server.once("error", () => done(false));
        this.server.listen(port, "127.0.0.1", () => done(true));
      });
      if (listening) break;
    }
    const addr = this.server.address();
    if (!addr || typeof addr !== "object") return;
    this.url = `http://127.0.0.1:${addr.port}/`;
    console.log(`vitest-viz: live at ${this.url}`);
    if (this.open) await this.openWindow();
  }

  async openWindow() {
    try {
      const { chromium } = await import("playwright-core"); // Playwright's own Chromium, never the system browser
      this.browser = await chromium.launch({ headless: false, args: [`--app=${this.url}`, "--window-size=900,900"] });
    } catch (error) {
      console.log(`vitest-viz: could not open a window (${String(error.message).split("\n")[0]}); open the URL yourself`);
    }
  }

  onTestRunStart() {
    this.reset();
    this.log = [];
    this.send({ type: "reset", title: this.title });
  }

  onTestModuleCollected(module) {
    const i = this.fileIndex(module);
    const count = [...module.children.allTests()].length;
    this.files[i].count = count;
    this.send({ type: "file", f: i, name: this.files[i].name, count });
  }

  onTestCaseResult(testCase) {
    const state = testCase.result().state; // passed | failed | skipped | pending
    if (state === "pending") return;
    const ev = {
      t: this.now(),
      f: this.fileIndex(testCase.module),
      s: state === "passed" ? "p" : state === "failed" ? "f" : "s",
      n: testCase.fullName,
      d: Math.round(testCase.diagnostic()?.duration ?? 0),
    };
    if (ev.s === "f") ev.e = String(testCase.result().errors?.[0]?.message ?? "").slice(0, 600);
    this.events.push(ev);
    this.send({ type: "test", ev });
  }

  onTestModuleEnd(module) {
    const f = this.fileIndex(module);
    this.files[f].d = Math.round(module.diagnostic()?.duration ?? 0);
    this.send({ type: "fileend", f, d: this.files[f].d });
  }

  async onTestRunEnd() {
    const data = { title: this.title, total: this.now(), files: this.files, events: this.events };
    this.send({ type: "end", total: data.total });
    mkdirSync(dirname(this.outFile), { recursive: true });
    const page = readFileSync(TEMPLATE, "utf8").replace(DATA_MARKER, () => JSON.stringify(data).replaceAll("<", "\\u003c"));
    writeFileSync(this.outFile, page);
    console.log(`\nvitest-viz: ${this.events.length} tests -> ${this.outFile}`);
    if (this.watch) return;
    // Give the page a moment to receive the end message. With a window open, wait for it to close (at most a minute).
    await new Promise((r) => setTimeout(r, 400));
    if (this.browser?.isConnected()) {
      await Promise.race([new Promise((r) => this.browser.on("disconnected", r)), new Promise((r) => setTimeout(r, 60_000))]);
      await this.browser.close().catch(() => {});
    }
    await this.close();
  }

  async close() {
    for (const res of this.clients) res.end();
    this.server?.closeAllConnections();
    await new Promise((r) => (this.server ? this.server.close(r) : r()));
  }
}
