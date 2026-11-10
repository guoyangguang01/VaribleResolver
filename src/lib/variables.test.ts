import assert from "node:assert/strict";
import test from "node:test";
import {
  detectSourceLineEnding,
  normalizeSourceText,
  restoreSourceLineEndings,
} from "./variables.ts";

test("normalizes CRLF and CR line endings", () => {
  assert.equal(
    normalizeSourceText("first\r\nsecond\rthird\nfourth"),
    "first\nsecond\nthird\nfourth",
  );
});

test("detects and restores LF, CRLF, and CR line endings", () => {
  for (const lineEnding of ["\n", "\r\n", "\r"] as const) {
    const source = `first${lineEnding}second${lineEnding}`;
    const normalized = normalizeSourceText(source);

    assert.equal(detectSourceLineEnding(source), lineEnding);
    assert.equal(normalized, "first\nsecond\n");
    assert.equal(restoreSourceLineEndings(normalized, lineEnding), source);
  }
});
