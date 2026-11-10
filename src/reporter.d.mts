import type { Reporter } from "vitest/reporters";

export interface VizOptions {
  /** Where the finished run is written, relative to the Vitest root. Default: `.vitest-viz/index.html`. */
  outFile?: string;
  /** Port for the live page. Falls back to a free one if busy. Default: 7378. */
  port?: number;
  /** Serve the live page while tests run. Set false to only write the replay file. Default: true. */
  live?: boolean;
  /** Open the live page in an app window of Playwright's bundled Chromium (needs `playwright-core`). Default: false. */
  open?: boolean;
  /** Text under the heading. Default: `vitest · <project folder>`. */
  title?: string;
}

export default class VizReporter implements Reporter {
  constructor(options?: VizOptions);
  /** Address of the live page, once the run has started. */
  url: string | undefined;
}
