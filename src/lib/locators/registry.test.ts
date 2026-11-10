import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCATOR_KINDS,
  LOCATOR_MODE_OPTIONS,
  createLocatorForStrategyMode,
  locatorKindForMode,
  locatorStrategyForKind,
  locatorStrategyForMode,
} from "./registry.ts";

test("registers exactly one complete strategy for every locator kind", () => {
  for (const kind of LOCATOR_KINDS) {
    const strategy = locatorStrategyForKind(kind);
    assert.equal(strategy.kind, kind);
    assert.equal(locatorKindForMode(strategy.mode), kind);
    assert.ok(strategy.optionLabel.length > 0);
  }
  assert.equal(
    new Set(LOCATOR_KINDS).size,
    LOCATOR_KINDS.length,
    "locator kind list contains duplicates",
  );
});

test("registers every UI mode exactly once", () => {
  assert.deepEqual(
    LOCATOR_MODE_OPTIONS.map((option) => option.value),
    [
      "auto",
      "fixedLength",
      "delimited",
      "startColumn",
      "wholeLine",
      "multiLine",
      "indefiniteLine",
      "jsonPath",
      "xmlPath",
      "pattern",
    ],
  );
  assert.equal(
    new Set(LOCATOR_MODE_OPTIONS.map((option) => option.value)).size,
    LOCATOR_MODE_OPTIONS.length,
  );
});

test("creates locator drafts through the same strategy registry", () => {
  const values = {
    startRowIndex: 2,
    startColumnIndex: 3,
    endRowIndex: 4,
    endColumnIndex: 5,
    separator: ",",
    fieldIndex: 1,
    startMarker: "BEGIN",
    endMarker: "END",
    jsonPath: "$.value",
    xmlPath: "/root/value",
    pattern: "value=(\\d+)",
    flags: "i",
    captureGroup: 1,
    occurrence: 0,
  };

  for (const option of LOCATOR_MODE_OPTIONS) {
    const locator = createLocatorForStrategyMode(option.value, values);
    const expectedKind = locatorKindForMode(option.value);
    assert.equal(locator.kind, expectedKind);
    assert.equal(
      locatorStrategyForMode(option.value).toEditorState(locator).mode,
      option.value,
    );
  }
});

test("lets the automatic strategy consume a selected source range", () => {
  const locator = createLocatorForStrategyMode(
    "auto",
    {},
    {
      content: "VALUE = 12.5\n",
      selection: { start: 8, end: 12 },
    },
  );

  assert.equal(locator.kind, "autoPosition");
  if (locator.kind !== "autoPosition") return;
  assert.equal(locator.startRowIndex, 1);
  assert.equal(locator.startColumnIndex, 8);
  assert.equal(locator.endColumnIndex, 12);
  assert.ok(locator.tokenRange);
});
