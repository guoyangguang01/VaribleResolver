import { LauncherError } from "../errors.ts";
import type {
  DelimitedLaunchLocator,
  LocatorStrategy,
  ResolvedLaunchBinding,
} from "../model.ts";
import { lineAt, trimmedRange } from "../shared.ts";

function resolveDelimitedLocator(
  source: string,
  locator: DelimitedLaunchLocator,
): ResolvedLaunchBinding {
  if (!locator.separator) {
    throw new LauncherError("分段定位必须填写分隔符。");
  }
  if (!Number.isInteger(locator.fieldIndex) || locator.fieldIndex < 0) {
    throw new LauncherError("分段序号必须是从 0 开始的整数。");
  }
  const line = lineAt(source, locator.rowIndex);
  const parts = line.text.split(locator.separator);
  if (locator.fieldIndex >= parts.length) {
    throw new LauncherError(
      `第 ${locator.rowIndex} 行只有 ${parts.length} 个分段。`,
    );
  }
  const fieldStart =
    parts
      .slice(0, locator.fieldIndex)
      .reduce(
        (length, part) => length + part.length + locator.separator.length,
        0,
      );
  return trimmedRange(
    source,
    line.start + fieldStart,
    line.start + fieldStart + parts[locator.fieldIndex].length,
  );
}

export const delimitedLocatorStrategy: LocatorStrategy<"delimited"> = {
  kind: "delimited",
  mode: "delimited",
  optionLabel: "分段",
  create(values) {
    return {
      kind: "delimited",
      rowIndex: values.startRowIndex ?? 1,
      separator: values.separator ?? "",
      fieldIndex: values.fieldIndex ?? 0,
    };
  },
  toEditorState(locator) {
    return {
      mode: "delimited",
      values: {
        startRowIndex: locator.rowIndex,
        separator: locator.separator,
        fieldIndex: locator.fieldIndex,
      },
    };
  },
  resolve: resolveDelimitedLocator,
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
    return `分段 · 第 ${locator.fieldIndex} 段`;
  },
  details(locator) {
    return [
      { label: "行", value: String(locator.rowIndex) },
      { label: "分隔符", value: locator.separator },
      { label: "分段序号", value: String(locator.fieldIndex) },
    ];
  },
};
