import type { SourceRange } from "../../variables.ts";
import { LauncherError } from "../errors.ts";
import type {
  AutoPositionLaunchLocator,
  LocatorStrategy,
  ResolvedLaunchBinding,
  RowColumnLaunchLocator,
} from "../model.ts";
import {
  lineAt,
  sourceLines,
  tokenizeSpecialCharacters,
  tokenRangeForSelection,
} from "../shared.ts";
import { resolveRowColumnLocator } from "./rowColumn.ts";

export function resolveAutoPositionLocator(
  source: string,
  locator: AutoPositionLaunchLocator,
): ResolvedLaunchBinding {
  const tokenRange = locator.tokenRange;
  if (!tokenRange) {
    return resolveRowColumnLocator(source, {
      kind: "rowColumn",
      startRowIndex: locator.startRowIndex,
      startColumnIndex: locator.startColumnIndex,
      endRowIndex: locator.endRowIndex,
      endColumnIndex: locator.endColumnIndex,
    });
  }
  if (locator.startRowIndex !== locator.endRowIndex) {
    throw new LauncherError("自动分词定位仅支持同一行内的选区。");
  }
  const line = lineAt(source, locator.startRowIndex);
  const tokens = tokenizeSpecialCharacters(line.text);
  if (tokens.length !== tokenRange.tokenCount) {
    throw new LauncherError(
      "自动分词定位已失效：当前行的特殊字符 Token 数量发生变化。",
    );
  }
  const startToken = tokens[tokenRange.startTokenIndex];
  const endToken = tokens[tokenRange.endTokenIndex];
  if (
    !Number.isInteger(tokenRange.startTokenIndex) ||
    !Number.isInteger(tokenRange.endTokenIndex) ||
    !Number.isInteger(tokenRange.startOffsetFromTokenStart) ||
    !Number.isInteger(tokenRange.endOffsetFromTokenEnd) ||
    !startToken ||
    !endToken ||
    tokenRange.startOffsetFromTokenStart < 0 ||
    tokenRange.endOffsetFromTokenEnd < 0
  ) {
    throw new LauncherError("自动分词定位边界无效。");
  }
  const startColumn =
    startToken.startCol + tokenRange.startOffsetFromTokenStart;
  const endColumn =
    endToken.endCol - tokenRange.endOffsetFromTokenEnd;
  if (
    startColumn > startToken.endCol ||
    endColumn < endToken.startCol ||
    endColumn <= startColumn
  ) {
    throw new LauncherError("自动分词定位边界越界。");
  }
  return resolveRowColumnLocator(source, {
    kind: "rowColumn",
    startRowIndex: locator.startRowIndex,
    startColumnIndex: startColumn,
    endRowIndex: locator.startRowIndex,
    endColumnIndex: endColumn,
  });
}

export function createAutoPositionLocatorFromContent(
  content: string,
  selection: SourceRange,
): AutoPositionLaunchLocator {
  if (selection.end <= selection.start) {
    throw new LauncherError("请先在文件中选中要绑定的内容。");
  }
  if (selection.start < 0 || selection.end > content.length) {
    throw new LauncherError("选区已失效，请重新选择。");
  }
  const startLineStart =
    content.lastIndexOf("\n", Math.max(0, selection.start - 1)) + 1;
  const lastSelectedIndex = Math.max(selection.start, selection.end - 1);
  const endLineStart =
    content.lastIndexOf("\n", Math.max(0, lastSelectedIndex - 1)) + 1;
  const startRowIndex =
    content.slice(0, selection.start).split("\n").length;
  const endRowIndex =
    content.slice(0, lastSelectedIndex).split("\n").length;
  const startColumnIndex = selection.start - startLineStart;
  const endColumnIndex = selection.end - endLineStart;
  const locator: AutoPositionLaunchLocator = {
    kind: "autoPosition",
    startRowIndex,
    startColumnIndex,
    endRowIndex,
    endColumnIndex,
  };
  if (startRowIndex === endRowIndex) {
    const line = sourceLines(content)[startRowIndex - 1];
    const tokenRange = line
      ? tokenRangeForSelection(
          line.text,
          startColumnIndex,
          endColumnIndex,
        )
      : undefined;
    if (tokenRange) locator.tokenRange = tokenRange;
  }
  return locator;
}

export const autoPositionLocatorStrategy: LocatorStrategy<"autoPosition"> = {
  kind: "autoPosition",
  mode: "auto",
  optionLabel: "自动",
  create(values, context) {
    if (
      context?.content !== undefined &&
      context.selection &&
      context.selection.end > context.selection.start
    ) {
      return createAutoPositionLocatorFromContent(
        context.content,
        context.selection,
      );
    }
    return {
      kind: "autoPosition",
      startRowIndex: values.startRowIndex ?? 1,
      startColumnIndex: values.startColumnIndex ?? 0,
      endRowIndex: values.endRowIndex ?? values.startRowIndex ?? 1,
      endColumnIndex:
        values.endColumnIndex ?? values.startColumnIndex ?? 0,
    };
  },
  toEditorState(locator) {
    return {
      mode: "auto",
      values: {
        startRowIndex: locator.startRowIndex,
        startColumnIndex: locator.startColumnIndex,
        endRowIndex: locator.endRowIndex,
        endColumnIndex: locator.endColumnIndex,
      },
    };
  },
  resolve: resolveAutoPositionLocator,
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
    const updated: AutoPositionLaunchLocator = {
      ...locator,
      endRowIndex:
        locator.startRowIndex + Math.max(0, lines.length - 1),
      endColumnIndex:
        lines.length === 1
          ? locator.startColumnIndex + context.replacement.length
          : (lines.at(-1)?.length ?? 0),
    };
    if (!locator.tokenRange) return updated;
    const fixedLocator: RowColumnLaunchLocator = {
      kind: "rowColumn",
      startRowIndex: updated.startRowIndex,
      startColumnIndex: updated.startColumnIndex,
      endRowIndex: updated.endRowIndex,
      endColumnIndex: updated.endColumnIndex,
    };
    try {
      const expected = resolveRowColumnLocator(context.source, fixedLocator);
      const resolved = resolveAutoPositionLocator(context.source, updated);
      if (
        resolved.start === expected.start &&
        resolved.end === expected.end
      ) {
        return updated;
      }
    } catch {
      // Preserve the existing fixed-coordinate behavior after a write.
    }
    return { ...updated, tokenRange: undefined };
  },
  summary(locator) {
    return `自动 · R${locator.startRowIndex}:C${locator.startColumnIndex}`;
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
