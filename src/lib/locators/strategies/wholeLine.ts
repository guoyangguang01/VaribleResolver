import type {
  LocatorStrategy,
  ResolvedLaunchBinding,
  WholeLineLaunchLocator,
} from "../model.ts";
import { lineAt } from "../shared.ts";

function resolveWholeLineLocator(
  source: string,
  locator: WholeLineLaunchLocator,
): ResolvedLaunchBinding {
  const line = lineAt(source, locator.rowIndex);
  return {
    start: line.start,
    end: line.end,
    value: line.text,
  };
}

export const wholeLineLocatorStrategy: LocatorStrategy<"wholeLine"> = {
  kind: "wholeLine",
  mode: "wholeLine",
  optionLabel: "整行",
  create(values) {
    return {
      kind: "wholeLine",
      rowIndex: values.startRowIndex ?? 1,
    };
  },
  toEditorState(locator) {
    return {
      mode: "wholeLine",
      values: { startRowIndex: locator.rowIndex },
    };
  },
  resolve: resolveWholeLineLocator,
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
    return `整行 · R${locator.rowIndex}`;
  },
  details(locator) {
    return [{ label: "行", value: String(locator.rowIndex) }];
  },
};
