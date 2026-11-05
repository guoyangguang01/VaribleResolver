export type SourceFlavor = "generic" | "ccl" | "cse" | "python" | "workbench";

export function normalizeSourceText(source: string): string {
  return source.replace(/\r\n?/g, "\n");
}

export interface SourceRange {
  start: number;
  end: number;
}

export interface VariableContextValue {
  variableName: string;
  value: string;
  unit: string | null;
  line: number;
  valueRange: SourceRange;
}

export interface ParsedVariable {
  variableName: string;
  value: string;
  rawValue: string;
  unit: string | null;
  valuePrefix: string | null;
  valueQuote: string | null;
  line: number;
  lineStart: number;
  lineEnd: number;
  nameRange: SourceRange;
  valueRange: SourceRange;
  unitRange: SourceRange | null;
  path: string[];
  material: string | null;
  section: string | null;
  contextValues: VariableContextValue[];
}

interface SourceLine {
  start: number;
  end: number;
  text: string;
}

interface AssignmentParts {
  indentation: string;
  variableName: string;
  nameRange: SourceRange;
  value: string;
  rawValue: string;
  valueRange: SourceRange;
  unit: string | null;
  unitRange: SourceRange | null;
  valuePrefix: string | null;
  valueQuote: string | null;
}

interface IndentedPathResult {
  path: string[];
  contextValues: VariableContextValue[];
}

export function sourceFlavorFromFilename(filename: string): SourceFlavor {
  const dotIndex = filename.lastIndexOf(".");
  const extension =
    dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : "";
  if (extension === ".ccl") return "ccl";
  if (extension === ".cse") return "cse";
  if (extension === ".py") return "python";
  if (extension === ".wbjn") return "workbench";
  return "generic";
}

export function detectSourceFlavor(
  source: string,
  filename?: string,
): SourceFlavor {
  const filenameFlavor = filename
    ? sourceFlavorFromFilename(filename)
    : "generic";
  if (filenameFlavor !== "generic") return filenameFlavor;

  if (
    /\bSetScriptVersion\s*\(/i.test(source) &&
    /["']{3}[\s\S]*\bLIBRARY\s*:/i.test(source)
  ) {
    return "workbench";
  }
  if (
    /^\s*(?:LIBRARY|MATERIAL|PROPERTIES|DOMAIN|BOUNDARY)\s*:/im.test(
      source,
    )
  ) {
    return "ccl";
  }
  if (/^\s*(?:COMMAND FILE|PLANE)\s*:/im.test(source)) {
    return "cse";
  }
  if (
    /^\s*(?:async\s+def|def|class|for|while|with|try|except)\b.*:\s*$/im.test(
      source,
    ) ||
    /^\s*(?:import|from)\s+[A-Za-z_]/m.test(source) ||
    /\b(?:ExtAPI|DataModelObjectCategory)\b/.test(source)
  ) {
    return "python";
  }
  return "generic";
}

export function lineNumberAt(source: string, index: number): number {
  let line = 1;
  const end = Math.max(0, Math.min(index, source.length));
  for (let cursor = 0; cursor < end; cursor += 1) {
    if (source.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

export function findVariableAt(
  variables: ParsedVariable[],
  index: number,
): ParsedVariable | null {
  return (
    variables.find(
      (variable) =>
        index >= variable.lineStart && index <= variable.lineEnd,
    ) ?? null
  );
}

function findOpenCallContext(
  source: string,
  lineStart: number,
): string | null {
  const parentheses: number[] = [];
  let quote: string | null = null;
  let quoteLength = 1;
  let escaped = false;

  for (let index = 0; index < lineStart; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (source.startsWith(quote.repeat(quoteLength), index)) {
        index += quoteLength - 1;
        quote = null;
      }
      continue;
    }
    if (character === "#") {
      const newline = source.indexOf("\n", index);
      if (newline < 0 || newline >= lineStart) break;
      index = newline;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      quoteLength = source.startsWith(character.repeat(3), index) ? 3 : 1;
      index += quoteLength - 1;
      continue;
    }
    if (character === "(") {
      parentheses.push(index);
    } else if (character === ")" && parentheses.length > 0) {
      parentheses.pop();
    }
  }

  const openIndex = parentheses.at(-1);
  if (openIndex === undefined) return null;
  const prefix = source.slice(Math.max(0, openIndex - 200), openIndex);
  const nameMatch = /([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*$/.exec(prefix);
  if (!nameMatch) return null;
  if (/^(?:if|elif|while|for|with|return|assert)$/.test(nameMatch[1])) {
    return null;
  }
  return `${nameMatch[1]}(...)`;
}

export function selectVariableOccurrences(
  variables: ParsedVariable[],
  target: ParsedVariable,
): ParsedVariable[] {
  const pathKey = target.path.join("\u001f");
  const pathMatches = variables.filter(
    (variable) =>
      variable.variableName === target.variableName &&
      variable.path.join("\u001f") === pathKey,
  );
  if (pathMatches.length <= 1) return pathMatches;

  const valueMatches = pathMatches.filter(
    (variable) =>
      variable.value === target.value && variable.unit === target.unit,
  );
  return valueMatches.length > 0 ? valueMatches : pathMatches;
}

export function makeSnippet(
  source: string,
  variable: ParsedVariable,
  radius = 24,
): string {
  const start = Math.max(0, variable.valueRange.start - radius);
  const end = Math.min(source.length, variable.valueRange.end + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < source.length ? "…" : "";
  return `${prefix}${source
    .slice(start, end)
    .replace(/\s+/g, " ")
    .trim()}${suffix}`;
}

function splitLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;

  while (start <= source.length) {
    const newline = source.indexOf("\n", start);
    const end = newline === -1 ? source.length : newline;
    lines.push({
      start,
      end,
      text: source.slice(start, end).replace(/\r$/, ""),
    });
    if (newline === -1) break;
    start = newline + 1;
  }

  return lines;
}

function lineBoundsAt(source: string, index: number): SourceLine {
  const safeIndex = Math.max(0, Math.min(index, source.length));
  const start = source.lastIndexOf("\n", Math.max(0, safeIndex - 1)) + 1;
  const newline = source.indexOf("\n", safeIndex);
  const end = newline === -1 ? source.length : newline;
  const text = source.slice(start, end).replace(/\r$/, "");
  return {
    start,
    end: start + text.length,
    text,
  };
}

function indentationWidth(indentation: string): number {
  return Array.from(indentation).reduce(
    (width, character) => width + (character === "\t" ? 4 : 1),
    0,
  );
}

function findCommentStart(text: string): number {
  let quote: string | null = null;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "#") {
      return index;
    }
  }

  return -1;
}

function findAssignmentEqual(text: string): number {
  let quote: string | null = null;
  let escaped = false;
  let parentheses = 0;
  let braces = 0;
  let brackets = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "#") break;
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "(") parentheses += 1;
    else if (character === ")") parentheses = Math.max(0, parentheses - 1);
    else if (character === "{") braces += 1;
    else if (character === "}") braces = Math.max(0, braces - 1);
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets = Math.max(0, brackets - 1);
    else if (character === "=") {
      const previous = text[index - 1] ?? "";
      const next = text[index + 1] ?? "";
      if (
        next === "=" ||
        previous === "=" ||
        "!<>:".includes(previous) ||
        "+-*/%&|^@".includes(previous)
      ) {
        continue;
      }
      if (parentheses === 0 && braces === 0 && brackets === 0) {
        return index;
      }
    }
  }

  return -1;
}

function findTopLevelColon(text: string): number {
  let quote: string | null = null;
  let escaped = false;
  let brackets = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === "[" || character === "(") brackets += 1;
    else if (character === "]" || character === ")")
      brackets = Math.max(0, brackets - 1);
    else if (character === ":" && brackets === 0) return index;
  }

  return -1;
}

function isPythonVariableName(value: string): boolean {
  return /^[A-Za-z_]\w*(?:(?:\.[A-Za-z_]\w*)|(?:\[[^\]]+\]))*$/.test(
    value,
  );
}

function parseName(
  lhs: string,
  lineStart: number,
): { variableName: string; nameRange: SourceRange } | null {
  let candidate = lhs;
  const colon = findTopLevelColon(candidate);
  if (colon >= 0) candidate = candidate.slice(0, colon);

  const leading = candidate.length - candidate.trimStart().length;
  const variableName = candidate.trim();
  if (!variableName) return null;

  if (
    !isPythonVariableName(variableName) &&
    /[=<>{}()[\],"']/.test(variableName)
  ) {
    return null;
  }

  return {
    variableName,
    nameRange: {
      start: lineStart + leading,
      end: lineStart + leading + variableName.length,
    },
  };
}

function parseStringLiteral(
  rawValue: string,
  absoluteStart: number,
): {
  value: string;
  valueRange: SourceRange;
  prefix: string;
  quote: string;
} | null {
  let prefixEnd = 0;
  while (
    prefixEnd < rawValue.length &&
    /[rRuUbBfF]/.test(rawValue[prefixEnd])
  ) {
    prefixEnd += 1;
  }

  const quoteCharacter = rawValue[prefixEnd];
  if (quoteCharacter !== "'" && quoteCharacter !== '"') return null;
  const quoteLength = rawValue.startsWith(
    quoteCharacter.repeat(3),
    prefixEnd,
  )
    ? 3
    : 1;
  const delimiter = quoteCharacter.repeat(quoteLength);
  const contentStart = prefixEnd + quoteLength;
  const closing = rawValue.lastIndexOf(delimiter);
  if (closing < contentStart) return null;

  return {
    value: rawValue.slice(contentStart, closing),
    valueRange: {
      start: absoluteStart + contentStart,
      end: absoluteStart + closing,
    },
    prefix: rawValue.slice(0, prefixEnd),
    quote: delimiter,
  };
}

function parseTrailingUnit(
  rawValue: string,
  absoluteStart: number,
): {
  value: string;
  valueRange: SourceRange;
  unit: string | null;
  unitRange: SourceRange | null;
} {
  if (!rawValue.endsWith("]")) {
    return {
      value: rawValue,
      valueRange: {
        start: absoluteStart,
        end: absoluteStart + rawValue.length,
      },
      unit: null,
      unitRange: null,
    };
  }

  const unitStart = rawValue.lastIndexOf("[");
  if (unitStart <= 0 || rawValue.indexOf("[") !== unitStart) {
    return {
      value: rawValue,
      valueRange: {
        start: absoluteStart,
        end: absoluteStart + rawValue.length,
      },
      unit: null,
      unitRange: null,
    };
  }

  const valueText = rawValue.slice(0, unitStart).trimEnd();
  return {
    value: valueText,
    valueRange: {
      start: absoluteStart,
      end: absoluteStart + valueText.length,
    },
    unit: rawValue.slice(unitStart),
    unitRange: {
      start: absoluteStart + unitStart,
      end: absoluteStart + rawValue.length,
    },
  };
}

function parseAssignmentSyntax(
  line: SourceLine,
): AssignmentParts | null {
  const equalIndex = findAssignmentEqual(line.text);
  if (equalIndex < 0) return null;

  const lhs = line.text.slice(0, equalIndex);
  const name = parseName(lhs, line.start);
  if (!name) return null;

  const afterEqual = line.text.slice(equalIndex + 1);
  const commentStart = findCommentStart(afterEqual);
  const withoutComment =
    commentStart >= 0 ? afterEqual.slice(0, commentStart) : afterEqual;
  const leading = withoutComment.length - withoutComment.trimStart().length;
  const rawValue = withoutComment.trim();
  if (!rawValue) return null;
  const rawStart = line.start + equalIndex + 1 + leading;

  const stringLiteral = parseStringLiteral(rawValue, rawStart);
  if (stringLiteral) {
    return {
      indentation: lhs.slice(0, lhs.search(/\S|$/)),
      variableName: name.variableName,
      nameRange: name.nameRange,
      value: stringLiteral.value,
      rawValue,
      valueRange: stringLiteral.valueRange,
      unit: null,
      unitRange: null,
      valuePrefix: stringLiteral.prefix,
      valueQuote: stringLiteral.quote,
    };
  }

  const value = parseTrailingUnit(rawValue, rawStart);
  return {
    indentation: lhs.slice(0, lhs.search(/\S|$/)),
    variableName: name.variableName,
    nameRange: name.nameRange,
    value: value.value,
    rawValue,
    valueRange: value.valueRange,
    unit: value.unit,
    unitRange: value.unitRange,
    valuePrefix: null,
    valueQuote: null,
  };
}

function collectBlockPath(
  source: string,
  lineStart: number,
  assignmentIndentation: string,
): string[] {
  const path: string[] = [];
  let parentIndent = indentationWidth(assignmentIndentation);
  let cursor = lineStart;

  while (cursor > 0) {
    const newlineBeforeCursor = cursor - 1;
    const previousLineStart =
      source.lastIndexOf("\n", Math.max(0, newlineBeforeCursor - 1)) + 1;
    const previousLine = source
      .slice(previousLineStart, newlineBeforeCursor)
      .replace(/\r$/, "");
    cursor = previousLineStart;

    if (
      !previousLine.trim() ||
      previousLine.trimStart().startsWith("#") ||
      /^\s*END\s*$/i.test(previousLine)
    ) {
      continue;
    }

    const header = /^(\s*)([^=#\r\n]+?)\s*:\s*(.*?)\s*$/.exec(previousLine);
    if (!header) continue;
    const headerIndent = indentationWidth(header[1]);
    if (headerIndent >= parentIndent) continue;

    const label = header[2].trim();
    const detail = header[3].trim();
    path.unshift(detail ? `${label}: ${detail}` : label);
    parentIndent = headerIndent;
  }

  return path;
}

function collectIndentedContext(
  source: string,
  lines: SourceLine[],
  lineIndex: number,
  assignmentIndentation: string,
): IndentedPathResult {
  const path: string[] = [];
  let parentIndent = indentationWidth(assignmentIndentation);
  const blockHeader =
    /^(\s*)((?:async\s+def|def|class|if|elif|else|for|while|with|try|except|finally)\b.*?:)\s*(?:#.*)?$/;

  for (let index = lineIndex - 1; index >= 0; index -= 1) {
    const previousLine = lines[index].text;
    if (!previousLine.trim() || previousLine.trimStart().startsWith("#")) {
      continue;
    }
    const header = blockHeader.exec(previousLine);
    if (!header) continue;
    const headerIndent = indentationWidth(header[1]);
    if (headerIndent >= parentIndent) continue;
    path.unshift(header[2].trim().replace(/:$/, ""));
    parentIndent = headerIndent;
  }

  const referencedNames = new Set(
    path.flatMap((entry) => entry.match(/[A-Za-z_]\w*/g) ?? []),
  );
  const scanStart = Math.max(0, lineIndex - 200);
  for (let index = lineIndex - 1; index >= scanStart; index -= 1) {
    const anchor = parseAssignmentSyntax(lines[index]);
    if (!anchor || !referencedNames.has(anchor.variableName)) continue;

    const anchorText = `${anchor.variableName} = ${anchor.value}${
      anchor.unit ? ` ${anchor.unit}` : ""
    }`;
    return {
      path: [anchorText, ...path],
      contextValues: [
        {
          variableName: anchor.variableName,
          value: anchor.value,
          unit: anchor.unit,
          line: lineNumberAt(source, lines[index].start),
          valueRange: anchor.valueRange,
        },
      ],
    };
  }

  return { path, contextValues: [] };
}

function finishVariable(
  source: string,
  line: SourceLine,
  assignment: AssignmentParts,
  path: string[],
  contextValues: VariableContextValue[],
): ParsedVariable {
  const materialEntry = path.find((entry) => /^MATERIAL\s*:/i.test(entry));
  return {
    variableName: assignment.variableName,
    value: assignment.value,
    rawValue: assignment.rawValue,
    unit: assignment.unit,
    valuePrefix: assignment.valuePrefix,
    valueQuote: assignment.valueQuote,
    line: lineNumberAt(source, line.start),
    lineStart: line.start,
    lineEnd: line.start + line.text.length,
    nameRange: assignment.nameRange,
    valueRange: assignment.valueRange,
    unitRange: assignment.unitRange,
    path,
    material: materialEntry
      ? materialEntry.replace(/^MATERIAL\s*:\s*/i, "")
      : null,
    section:
      [...path]
        .reverse()
        .find(
          (entry) =>
            !/^(?:LIBRARY|MATERIAL\b|PROPERTIES\b)/i.test(entry),
        ) ?? null,
    contextValues,
  };
}

function multilineStringRanges(source: string): SourceRange[] {
  const ranges: SourceRange[] = [];
  const pattern = /(["']{3})[\s\S]*?\1/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    ranges.push({
      start: match.index + match[1].length,
      end: match.index + match[0].length - match[1].length,
    });
  }
  return ranges;
}

function mergeContextPath(
  indentedPath: string[],
  blockPath: string[],
): string[] {
  return [
    ...indentedPath,
    ...blockPath.filter((entry) => !indentedPath.includes(entry)),
  ];
}

export function parseVariables(source: string): ParsedVariable[] {
  const variables: ParsedVariable[] = [];
  const lines = splitLines(source);
  const multilineRanges = multilineStringRanges(source);

  lines.forEach((line, lineIndex) => {
    if (
      multilineRanges.some(
        (range) => line.start > range.start && line.start < range.end,
      )
    ) {
      return;
    }
    const assignment = parseAssignmentSyntax(line);
    if (!assignment) return;
    const callContext = findOpenCallContext(source, line.start);
    if (callContext) {
      const contextualAssignment = assignment.rawValue.endsWith(",")
        ? (() => {
            const rawValue = assignment.rawValue.slice(0, -1).trimEnd();
            const removed = assignment.rawValue.length - rawValue.length;
            return {
              ...assignment,
              rawValue,
              value: assignment.unit ? assignment.value : rawValue,
              valueRange: {
                ...assignment.valueRange,
                end: assignment.valueRange.end - removed,
              },
              unitRange: assignment.unitRange
                ? {
                    ...assignment.unitRange,
                    end: assignment.unitRange.end - removed,
                  }
                : null,
            };
          })()
        : assignment;
      variables.push(
        finishVariable(
          source,
          line,
          contextualAssignment,
          [callContext],
          [],
        ),
      );
      return;
    }

    const indentedContext = collectIndentedContext(
      source,
      lines,
      lineIndex,
      assignment.indentation,
    );
    const blockPath = collectBlockPath(
      source,
      line.start,
      assignment.indentation,
    );
    variables.push(
      finishVariable(
        source,
        line,
        assignment,
        mergeContextPath(indentedContext.path, blockPath),
        indentedContext.contextValues,
      ),
    );
  });

  return variables;
}

export function findVariableTarget(
  source: string,
  index: number,
): ParsedVariable | null {
  const variables = parseVariables(source);
  const bounds = lineBoundsAt(source, index);
  return (
    variables.find(
      (variable) =>
        variable.lineStart === bounds.start &&
        variable.lineEnd === bounds.end,
    ) ?? null
  );
}
