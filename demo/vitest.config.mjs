import { defineConfig } from "vitest/config";
import Viz from "../src/reporter.mjs";

// `npm run demo`: six fake test files, three of them failing, run three at a time.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["*.test.mjs"],
    maxWorkers: 3,
    reporters: ["default", new Viz({ outFile: process.env.DEMO_OUT ?? "../.vitest-viz/index.html", port: Number(process.env.DEMO_PORT ?? 7378), title: "vitest · demo" })],
  },
});
