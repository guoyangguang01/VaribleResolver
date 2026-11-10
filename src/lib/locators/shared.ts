import { LauncherError } from "./errors.ts";
import type {
  AutoTokenRange,
  LocatorRelocationContext,
  ResolvedLaunchBinding,
  SourceTextChange,
} from "./model.ts";

export interface LineEntry {
  start: number;
  end: number;
  text: string;
}

export function sourceLines(source: string): LineEntry[] {
  const lines: LineEntry[] = [];
  let start = 0;
  while (start <= source.length) {
    const newline = source.indexOf("\n", start);
    const end = newline < 0 ? source.length : newline;
    lines.push({ start, end, text: source.slice(start, end) });
    if (newline < 0) break;
    start = newline + 1;
  }
  return lines;
}

export interface SpecialCharacterToken {
  index: number;
  startCol: number;
  endCol: number;
}

const SPECIAL_TOKEN_CHARACTER = /[\s\p{P}\p{S}]/u;

export function tokenizeSpecialCharacters(
  lineText: string,
): SpecialCharacterToken[] {
  const tokens: SpecialCharacterToken[] = [];
  let regularTokenStart = -1;
  let column = 0;
  while (column < lineText.length) {
    const codePoint = lineText.codePointAt(column);
    if (codePoint === undefined) break;
    const character = String.fromCodePoint(codePoint);
    const characterEnd = column + character.length;
    if (SPECIAL_TOKEN_CHARACTER.test(character)) {
      if (regularTokenStart >= 0) {
        tokens.push({
          index: tokens.length,
          startCol: regularTokenStart,
          endCol: column,
        });
        regularTokenStart = -1;
      }
      tokens.push({
        index: tokens.length,
        startCol: column,
        endCol: characterEnd,
      });
    } else if (regularTokenStart < 0) {
      regularTokenStart = column;
    }
    column = characterEnd;
  }
  if (regularTokenStart >= 0) {
    tokens.push({
      index: tokens.length,
      startCol: regularTokenStart,
      endCol: lineText.length,
    });
  }
  return tokens;
}

export function tokenRangeForSelection(
  lineText: string,
  startColumn: number,
  endColumn: number,
): AutoTokenRange | undefined {
  if (endColumn <= startColumn) return undefined;
  const tokens = tokenizeSpecialCharacters(lineText);
  const startToken = tokens.find(
    (token) =>
      startColumn >= token.startCol && startColumn < token.endCol,
  );
  const endToken = tokens.find(
    (token) => endColumn > token.startCol && endColumn <= token.endCol,
  );
  if (!startToken || !endToken) return undefined;
  return {
    tokenCount: tokens.length,
    startTokenIndex: startToken.index,
    startOffsetFromTokenStart: startColumn - startToken.startCol,
    endTokenIndex: endToken.index,
    endOffsetFromTokenEnd: endToken.endCol - endColumn,
  };
}

export function lineAt(source: string, rowIndex: number): LineEntry {
  const line = sourceLines(source)[rowIndex - 1];
  if (!line) {
    throw new LauncherError(`第 ${rowIndex} 行不存在。`);
  }
  return line;
}

export function trimmedRange(
  source: string,
  start: number,
  end: number,
): ResolvedLaunchBinding {
  let valueStart = start;
  let valueEnd = end;
  while (valueStart < valueEnd && /\s/.test(source[valueStart])) {
    valueStart += 1;
  }
  while (valueEnd > valueStart && /\s/.test(source[valueEnd - 1])) {
    valueEnd -= 1;
  }
  return {
    start: valueStart,
    end: valueEnd,
    value: source.slice(valueStart, valueEnd),
  };
}

function countLineBreaks(value: string): number {
  let count = 0;
  for (const character of value) {
    if (character === "\n") count += 1;
  }
  return count;
}

function lineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function rowDeltaBefore(
  previousContent: string,
  changes: readonly SourceTextChange[],
  anchor: number,
): number {
  let delta = 0;
  for (const change of changes) {
    if (change.to > anchor) continue;
    const removed = previousContent.slice(change.from, change.to);
    delta +=
      countLineBreaks(change.insert) - countLineBreaks(removed);
  }
  return delta;
}

export function createRelocationContext(
  previousContent: string,
  changes: readonly SourceTextChange[],
): LocatorRelocationContext {
  const starts = lineStarts(previousContent);
  return {
    previousContent,
    changes,
    mapRow(rowIndex: number): number | null {
      const anchor = starts[rowIndex - 1];
      if (anchor === undefined) return null;
      const mapped = rowIndex + rowDeltaBefore(
        previousContent,
        changes,
        anchor,
      );
      return mapped >= 1 ? mapped : null;
    },
  };
}
