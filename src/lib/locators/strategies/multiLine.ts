import { LauncherError } from "../errors.ts";
import type {
  LocatorStrategy,
  MultiLineLaunchLocator,
  ResolvedLaunchBinding,
} from "../model.ts";
import { lineAt } from "../shared.ts";

function resolveMultiLineLocator(
  source: string,
  locator: MultiLineLaunchLocator,
): ResolvedLaunchBinding {
  if (locator.endRowIndex < locator.startRowIndex) {
    throw new LauncherError("多行定位的结束行不能早于起始行。");
  }
  const startLine = lineAt(source, locator.startRowIndex);
  const endLine = lineAt(source, locator.endRowIndex);
  return {
    start: startLine.start,
    end: endLine.end,
    value: source.slice(startLine.start, endLine.end),
  };
}

export const multiLineLocatorStrategy: LocatorStrategy<"multiLine"> = {
  kind: "multiLine",
  mode: "multiLine",
  optionLabel: "多行",
  create(values) {
    return {
      kind: "multiLine",
      startRowIndex: values.startRowIndex ?? 1,
      endRowIndex: values.endRowIndex ?? values.startRowIndex ?? 1,
    };
  },
  toEditorState(locator) {
    return {
      mode: "multiLine",
      values: {
        startRowIndex: locator.startRowIndex,
        endRowIndex: locator.endRowIndex,
      },
    };
  },
  resolve: resolveMultiLineLocator,
  relocate(context, locator) {
    const startRowIndex = context.mapRow(locator.startRowIndex);
    const endRowIndex = context.mapRow(locator.endRowIndex);
    return startRowIndex === null || endRowIndex === null
      ? null
      : { ...locator, startRowIndex, endRowIndex };
  },
  formatReplacement(context) {
    return context.nextValue;
  },
  afterWrite(_context, locator) {
    return locator;
  },
  summary(locator) {
    return `多行 · R${locator.startRowIndex}-R${locator.endRowIndex}`;
  },
  details(locator) {
    return [
      { label: "起始行", value: String(locator.startRowIndex) },
      { label: "结束行", value: String(locator.endRowIndex) },
    ];
  },
};
