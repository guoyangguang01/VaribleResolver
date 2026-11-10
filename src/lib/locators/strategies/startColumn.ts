import type {
  LocatorStrategy,
  ResolvedLaunchBinding,
  StartColumnLaunchLocator,
} from "../model.ts";
import { lineAt, trimmedRange } from "../shared.ts";

function resolveStartColumnLocator(
  source: string,
  locator: StartColumnLaunchLocator,
): ResolvedLaunchBinding {
  const line = lineAt(source, locator.rowIndex);
  const startColumn = Math.min(
    locator.startColumnIndex,
    line.text.length,
  );
  return trimmedRange(source, line.start + startColumn, line.end);
}

export const startColumnLocatorStrategy: LocatorStrategy<"startColumn"> = {
  kind: "startColumn",
  mode: "startColumn",
  optionLabel: "起始列",
  create(values) {
    return {
      kind: "startColumn",
      rowIndex: values.startRowIndex ?? 1,
      startColumnIndex: values.startColumnIndex ?? 0,
    };
  },
  toEditorState(locator) {
    return {
      mode: "startColumn",
      values: {
        startRowIndex: locator.rowIndex,
        startColumnIndex: locator.startColumnIndex,
      },
    };
  },
  resolve: resolveStartColumnLocator,
  relocate(context, locator) {
    const rowIndex = context.mapRow(locator.rowIndex);
    return rowIndex === null ? null : { ...locator, rowIndex };
  },
  formatReplacement(context) {
    return context.nextValue;
  },
  afterWrite(_context, locator) {
    return locator;
  },
  summary(locator) {
    return `起始列 · R${locator.rowIndex}:C${locator.startColumnIndex}`;
  },
  details(locator) {
    return [
      { label: "行", value: String(locator.rowIndex) },
      { label: "起始列", value: String(locator.startColumnIndex) },
    ];
  },
};
