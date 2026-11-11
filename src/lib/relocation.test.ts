import assert from "node:assert/strict";
import test from "node:test";
import {
  createBindingFromLocator,
  createBindingFromSelection,
  createLaunchFile,
  createLocatorForMode,
  type LaunchBinding,
} from "./launcher.ts";
import {
  relocateBindingsAfterEdit,
  updateFileBindingLocator,
  type SourceTextChange,
} from "./relocation.ts";

const FILE_PATH = "C:\\Cases\\input.txt";

function wholeLineBinding(
  content: string,
  rowIndex: number,
): LaunchBinding {
  const file = createLaunchFile(FILE_PATH, content);
  return {
    ...createBindingFromLocator(
      file,
      createLocatorForMode("wholeLine", { startRowIndex: rowIndex }),
      "input",
      "目标行",
    ),
    value: "runtime-value",
  };
}

function relocate(
  previousContent: string,
  nextContent: string,
  changes: SourceTextChange[],
  bindings: LaunchBinding[],
) {
  return relocateBindingsAfterEdit(
    FILE_PATH,
    previousContent,
    nextContent,
    changes,
    bindings,
  );
}

test("moves line locators when lines are inserted above the target", () => {
  const previousContent = "alpha\nbeta\ntarget = 10\n";
  const nextContent = "inserted\nalpha\nbeta\ntarget = 10\n";
  const binding = wholeLineBinding(previousContent, 3);

  const result = relocate(
    previousContent,
    nextContent,
    [{ from: 0, to: 0, insert: "inserted\n" }],
    [binding],
  );

  assert.deepEqual(result.bindings[0].locator, {
    kind: "wholeLine",
    rowIndex: 4,
  });
  assert.equal(result.bindings[0].defaultValue, "target = 10");
  assert.equal(result.bindings[0].value, "runtime-value");
  assert.deepEqual(result.invalidatedParameterKeys, []);
});

test("applies multi-line insertion deltas to every row locator mode", () => {
  const previousContent = "alpha\nbeta\ntarget = 10\n";
  const nextContent = "one\ntwo\nalpha\nbeta\ntarget = 10\n";
  const file = createLaunchFile(FILE_PATH, previousContent);
  const bindings = [
    wholeLineBinding(previousContent, 3),
    {
      ...createBindingFromLocator(
        file,
        createLocatorForMode("multiLine", {
          startRowIndex: 2,
          endRowIndex: 3,
        }),
        "output",
        "多行",
      ),
    },
    {
      ...createBindingFromLocator(
        file,
        createLocatorForMode("delimited", {
          startRowIndex: 3,
          separator: "=",
          fieldIndex: 1,
        }),
        "input",
        "分段",
      ),
    },
  ];

  const result = relocate(
    previousContent,
    nextContent,
    [{ from: 0, to: 0, insert: "one\ntwo\n" }],
    bindings,
  );

  assert.equal(
    "rowIndex" in result.bindings[0].locator
      ? result.bindings[0].locator.rowIndex
      : null,
    5,
  );
  assert.equal(
    "startRowIndex" in result.bindings[1].locator
      ? result.bindings[1].locator.startRowIndex
      : null,
    4,
  );
  assert.equal(
    "endRowIndex" in result.bindings[1].locator
      ? result.bindings[1].locator.endRowIndex
      : null,
    5,
  );
  assert.equal(
    "rowIndex" in result.bindings[2].locator
      ? result.bindings[2].locator.rowIndex
      : null,
    5,
  );
});

test("moves line locators when preceding lines are deleted", () => {
  const previousContent = "alpha\nbeta\ntarget\n";
  const nextContent = "beta\ntarget\n";
  const binding = wholeLineBinding(previousContent, 3);

  const result = relocate(
    previousContent,
    nextContent,
    [{ from: 0, to: 6, insert: "" }],
    [binding],
  );

  assert.deepEqual(result.bindings[0].locator, {
    kind: "wholeLine",
    rowIndex: 2,
  });
});

test("does not move a locator for edits below its target", () => {
  const previousContent = "target\nalpha\n";
  const nextContent = "target\nalpha\ninserted\n";
  const binding = wholeLineBinding(previousContent, 1);

  const result = relocate(
    previousContent,
    nextContent,
    [
      {
        from: previousContent.length,
        to: previousContent.length,
        insert: "inserted\n",
      },
    ],
    [binding],
  );

  assert.deepEqual(result.bindings[0].locator, {
    kind: "wholeLine",
    rowIndex: 1,
  });
});

test("updates the default value but not the runtime value when the target is edited", () => {
  const previousContent = "before\ntarget = 10\nafter\n";
  const nextContent = "before\ntarget = 99\nafter\n";
  const binding = wholeLineBinding(previousContent, 2);
  const from = previousContent.indexOf("target");
  const to = from + "target = 10".length;

  const result = relocate(
    previousContent,
    nextContent,
    [{ from, to, insert: "target = 99" }],
    [binding],
  );

  assert.equal(result.bindings[0].defaultValue, "target = 99");
  assert.equal(result.bindings[0].value, "runtime-value");
  assert.equal(result.bindings[0].locatorInvalid, undefined);
});

test("updates the default value but not the runtime value when a new locator is applied", () => {
  const content = "VALUE: 42\nSTATUS: OK\n";
  const binding = {
    ...createBindingFromLocator(
      createLaunchFile(FILE_PATH, content),
      {
        kind: "rowColumn",
        startRowIndex: 1,
        startColumnIndex: 7,
        endRowIndex: 1,
        endColumnIndex: 9,
      },
      "input",
      "状态",
    ),
    value: "runtime-value",
    defaultValue: "42",
  };
  const locator = {
    kind: "rowColumn" as const,
    startRowIndex: 2,
    startColumnIndex: 0,
    endRowIndex: 2,
    endColumnIndex: 10,
  };

  const updated = updateFileBindingLocator(binding, locator, "STATUS: OK");

  assert.equal(updated.locator, locator);
  assert.equal(updated.defaultValue, "STATUS: OK");
  assert.equal(updated.value, "runtime-value");
});

test("marks a locator invalid when its complete target is deleted", () => {
  const previousContent = "before\ntarget = 10\nafter\n";
  const nextContent = "before\n\nafter\n";
  const binding = wholeLineBinding(previousContent, 2);
  const from = previousContent.indexOf("target");
  const to = from + "target = 10".length;

  const result = relocate(
    previousContent,
    nextContent,
    [{ from, to, insert: "" }],
    [binding],
  );

  assert.equal(result.bindings[0].locatorInvalid, true);
  assert.equal(result.bindings[0].locatorInvalidAnchor, 7);
  assert.deepEqual(result.invalidatedParameterKeys, [
    "input.txt.目标行",
  ]);
  assert.equal(result.bindings[0].defaultValue, "target = 10");
});

test("restores an invalid locator when the deleted target is undone", () => {
  const previousContent = "before\ntarget = 10\nafter\n";
  const deletedContent = "before\n\nafter\n";
  const binding = wholeLineBinding(previousContent, 2);
  const from = previousContent.indexOf("target");
  const to = from + "target = 10".length;
  const deleted = relocate(
    previousContent,
    deletedContent,
    [{ from, to, insert: "" }],
    [binding],
  );
  assert.equal(deleted.bindings[0].locatorInvalid, true);

  const restored = relocate(
    deletedContent,
    previousContent,
    [{ from, to: from, insert: "target = 10" }],
    deleted.bindings,
  );

  assert.equal(restored.bindings[0].locatorInvalid, undefined);
  assert.equal(
    restored.bindings[0].locatorInvalidAnchor,
    undefined,
  );
  assert.equal(restored.bindings[0].defaultValue, "target = 10");
  assert.deepEqual(restored.bindings[0].locator, {
    kind: "wholeLine",
    rowIndex: 2,
  });
});

test("does not restore an invalid locator for unrelated edits", () => {
  const previousContent = "before\ntarget = 10\nafter\n";
  const deletedContent = "before\n\nafter\n";
  const binding = wholeLineBinding(previousContent, 2);
  const from = previousContent.indexOf("target");
  const deleted = relocate(
    previousContent,
    deletedContent,
    [
      {
        from,
        to: from + "target = 10".length,
        insert: "",
      },
    ],
    [binding],
  );

  const edited = relocate(
    deletedContent,
    "before\n\nafter\nadded\n",
    [
      {
        from: deletedContent.length,
        to: deletedContent.length,
        insert: "added\n",
      },
    ],
    deleted.bindings,
  );

  assert.equal(edited.bindings[0].locatorInvalid, true);
});

test("does not mark an already unresolved binding invalid after an unrelated edit", () => {
  const previousContent = "alpha\ntarget\n";
  const nextContent = "inserted\nalpha\ntarget\n";
  const binding = {
    ...wholeLineBinding(previousContent, 1),
    locator: {
      kind: "wholeLine" as const,
      rowIndex: 5,
    },
  };

  const result = relocate(
    previousContent,
    nextContent,
    [{ from: 0, to: 0, insert: "inserted\n" }],
    [binding],
  );

  assert.equal(result.bindings[0].locatorInvalid, undefined);
  assert.deepEqual(result.invalidatedParameterKeys, []);
});

test("keeps automatic token locators while moving their row", () => {
  const previousContent = "set value = 10\n";
  const nextContent = "header\nset value = 10\n";
  const file = createLaunchFile(FILE_PATH, previousContent);
  const start = previousContent.indexOf("10");
  const binding = createBindingFromSelection(
    file,
    { start, end: start + 2 },
    "input",
    "Token 参数",
  );

  const result = relocate(
    previousContent,
    nextContent,
    [{ from: 0, to: 0, insert: "header\n" }],
    [binding],
  );

  assert.equal(result.bindings[0].locator.kind, "autoPosition");
  assert.equal(
    result.bindings[0].locator.kind === "autoPosition"
      ? result.bindings[0].locator.startRowIndex
      : null,
    2,
  );
  assert.equal(result.bindings[0].locator.kind === "autoPosition"
    ? Boolean(result.bindings[0].locator.tokenRange)
    : false, true);
  assert.equal(result.bindings[0].defaultValue, "10");
});

test("does not attempt to restore an already invalid locator", () => {
  const previousContent = "alpha\ntarget\n";
  const nextContent = "inserted\nalpha\ntarget\n";
  const binding = {
    ...wholeLineBinding(previousContent, 2),
    locatorInvalid: true,
  };

  const result = relocate(
    previousContent,
    nextContent,
    [{ from: 0, to: 0, insert: "inserted\n" }],
    [binding],
  );

  assert.equal(result.bindings[0], binding);
  assert.deepEqual(result.invalidatedParameterKeys, []);
});
