import { LauncherError } from "../errors.ts";
import type {
  LocatorStrategy,
  RowColumnLaunchLocator,
  ResolvedLaunchBinding,
} from "../model.ts";
import { sourceLines } from "../shared.ts";

export function resolveRowColumnLocator(
  source: string,
  locator: RowColumnLaunchLocator,
): ResolvedLaunchBinding {
  const lines = sourceLines(source);
  const startLine = lines[locator.startRowIndex - 1];
  const endLine = lines[locator.endRowIndex - 1];
  if (!startLine || !endLine) {
    throw new LauncherError(
      `行列定位越界：第 ${locator.startRowIndex}–${locator.endRowIndex} 行不存在。`,
    );
  }
  if (
    locator.startRowIndex < 1 ||
    locator.endRowIndex < locator.startRowIndex ||
    locator.startColumnIndex < 0 ||
    (locator.endRowIndex === locator.startRowIndex &&
      locator.endColumnIndex < locator.startColumnIndex)
  ) {
    throw new LauncherError("行列定位范围无效。");
  }
  const startColumn = Math.min(
    locator.startColumnIndex,
    startLine.text.length,
  );
  const endColumn = Math.min(
    locator.endColumnIndex,
    endLine.text.length,
  );
  const start = startLine.start + startColumn;
  const end = endLine.start + endColumn;
  return {
    start,
    end,
    value: source.slice(start, end),
  };
}

export const rowColumnLocatorStrategy: LocatorStrategy<"rowColumn"> = {
  kind: "rowColumn",
  mode: "fixedLength",
  optionLabel: "固定长度",
  create(values) {
    return {
      kind: "rowColumn",
      startRowIndex: values.startRowIndex ?? 1,
      startColumnIndex: values.startColumnIndex ?? 0,
      endRowIndex: values.endRowIndex ?? values.startRowIndex ?? 1,
      endColumnIndex: values.endColumnIndex ?? values.startColumnIndex ?? 0,
    };
  },
  toEditorState(locator) {
    return {
      mode: "fixedLength",
      values: {
        startRowIndex: locator.startRowIndex,
        startColumnIndex: locator.startColumnIndex,
        endRowIndex: locator.endRowIndex,
        endColumnIndex: locator.endColumnIndex,
      },
    };
  },
  resolve: resolveRowColumnLocator,
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
  afterWrite(context, locator) {
    const lines = context.replacement.split("\n");
    return {
      ...locator,
      endRowIndex:
        locator.startRowIndex + Math.max(0, lines.length - 1),
      endColumnIndex:
        lines.length === 1
          ? locator.startColumnIndex + context.replacement.length
          : (lines.at(-1)?.length ?? 0),
    };
  },
  summary(locator) {
    return `固定长度 · R${locator.startRowIndex}:C${locator.startColumnIndex}`;
  },
  details(locator) {
    return [
      { label: "起始行", value: String(locator.startRowIndex) },
      { label: "起始列", value: String(locator.startColumnIndex) },
      { label: "结束行", value: String(locator.endRowIndex) },
      { label: "结束列", value: String(locator.endColumnIndex) },
    ];
  },
};
