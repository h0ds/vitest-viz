# Contributing

- `npm test` runs the suite. It starts the real Vitest CLI against `demo/`, so it covers the live server too.
- `npm run demo` runs the fake suite with the reporter attached. Open the URL it prints while it runs.
- `npm run gif` rebuilds `docs/demo.gif` (needs ffmpeg on PATH). Do it when the look changes.
- No runtime dependencies. The reporter uses Node built-ins only, and the page is one HTML file with no libraries. If a change needs a dependency, say why in the PR.
- The page (`src/template.html`) must keep working when opened from a file, with no server.
- Never open the system browser from the reporter. The optional window uses Playwright's bundled Chromium only.
- Keep prose plain: no em dashes, no filler words, and say the specific thing.

## How it works

```
Vitest hooks ──> reporter.mjs ──┬─> in-memory event log ──> localhost server ──> live page (SSE)
                                └─> on run end: template.html + embedded log ──> .vitest-viz/index.html
```

Both pages are the same `template.html`. The live page starts empty and fills from the `/events` stream. The replay file has the finished run baked in as `DATA` and plays it back on a clock.
