import { expect, test } from "vitest";

// Deterministic fake workload: each test sleeps for a repeatable amount, and the listed ones fail.
export function suite(name, { count, failing = [], base = 40, spread = 90 }) {
  for (let i = 0; i < count; i++) {
    test(`${name} ${i + 1}`, async () => {
      await new Promise((r) => setTimeout(r, base + ((i * 37 + name.length * 11) % spread)));
      if (failing.includes(i)) expect(`${name}-${i}`).toBe("a different value");
    });
  }
}
