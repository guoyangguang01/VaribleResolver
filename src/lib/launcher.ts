import {
  sourceFlavorFromFilename,
  type SourceFlavor,
  type SourceRange,
} from "./variables.ts";

export type LaunchBindingDirection = "input" | "output";

export interface LaunchFile {
  path: string;
  sourcePath?: string;
  sourceContent?: string;
  name: string;
  content: string;
  flavor: SourceFlavor;
  size: number;
}

export interface AutoTokenRange {
  tokenCount: number;
  startTokenIndex: number;
  startOffsetFromTokenStart: number;
  endTokenIndex: number;
  endOffsetFromTokenEnd: number;
}

export interface AutoPositionLaunchLocator {
  kind: "autoPosition";
  startRowIndex: number;
  startColumnIndex: number;
  endRowIndex: number;
  endColumnIndex: number;
  tokenRange?: AutoTokenRange;
}

export interface RowColumnLaunchLocator {
  kind: "rowColumn";
  startRowIndex: number;
  endRowIndex: number;
  startColumnIndex: number;
  endColumnIndex: number;
}

export interface StartColumnLaunchLocator {
  kind: "startColumn";
  rowIndex: number;
  startColumnIndex: number;
}

export interface WholeLineLaunchLocator {
  kind: "wholeLine";
  rowIndex: number;
}

export interface MultiLineLaunchLocator {
  kind: "multiLine";
  startRowIndex: number;
  endRowIndex: number;
}

export interface DelimitedLaunchLocator {
  kind: "delimited";
  rowIndex: number;
  separator: string;
  fieldIndex: number;
}

export interface MarkerLaunchLocator {
  kind: "marker";
  startMarker: string;
  endMarker: string;
  occurrence: number;
}

export interface JsonPathLaunchLocator {
  kind: "jsonPath";
  path: string;
}

export interface XmlPathLaunchLocator {
  kind: "xmlPath";
  path: string;
}

export interface PatternLaunchLocator {
  kind: "pattern";
  pattern: string;
  flags: string;
  captureGroup: number;
  occurrence: number;
}

export type LaunchLocator =
  | AutoPositionLaunchLocator
  | RowColumnLaunchLocator
  | StartColumnLaunchLocator
  | WholeLineLaunchLocator
  | MultiLineLaunchLocator
  | DelimitedLaunchLocator
  | MarkerLaunchLocator
  | JsonPathLaunchLocator
  | XmlPathLaunchLocator
  | PatternLaunchLocator;

export type LaunchLocatorMode =
  | "auto"
  | "fixedLength"
  | "delimited"
  | "startColumn"
  | "wholeLine"
  | "multiLine"
  | "indefiniteLine"
  | "jsonPath"
  | "xmlPath"
  | "pattern";

export const LAUNCH_PARAMETER_TYPES = [
  "text",
  "number",
  "boolean",
  "path",
] as const;

export type LaunchParameterType =
  (typeof LAUNCH_PARAMETER_TYPES)[number];

export interface InputReferenceResolution {
  roots: Map<string, LaunchBinding>;
  errors: Map<string, string>;
}

const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inputFilePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function inputFileStem(filePath: string): string {
  const fileName = inputFilePath(filePath);
  const separator = fileName.lastIndexOf(".");
  return separator > 0 ? fileName.slice(0, separator) : fileName;
}

interface ParsedParameterReference {
  fileName: string;
  direction: "input" | "output";
  parameterName: string;
}

function parseParameterReference(
  value: string,
): ParsedParameterReference | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("@")) return null;
  const expression = trimmed.slice(1).trim();
  const match = /^(.+)\[(in|out)\]\.(.+)$/i.exec(expression);
  if (!match) return null;
  const fileName = match[1].trim();
  const parameterName = match[3].trim();
  if (!fileName || !parameterName) return null;
  return {
    fileName,
    direction: match[2].toLowerCase() === "in" ? "input" : "output",
    parameterName,
  };
}

function referencedInputBindings(
  reference: string,
  bindings: LaunchBinding[],
): LaunchBinding[] {
  const parsed = parseParameterReference(reference);
  if (!parsed || parsed.direction !== "input") return [];
  const fileName = parsed.fileName.toLowerCase();
  const parameterName = parsed.parameterName;
  return bindings.filter(
    (binding) =>
      binding.direction === "input" &&
      binding.name === parameterName &&
      (binding.scope === "free"
        ? FREE_PARAMETER_SCOPE.toLowerCase() === fileName
        : inputFilePath(binding.filePath).toLowerCase() === fileName ||
          inputFileStem(binding.filePath).toLowerCase() === fileName),
  );
}

function referencedOutputBindings(
  reference: string,
  bindings: LaunchBinding[],
): FileLaunchBinding[] {
  const parsed = parseParameterReference(reference);
  if (!parsed || parsed.direction !== "output") return [];
  const fileName = parsed.fileName.toLowerCase();
  const parameterName = parsed.parameterName;
  return bindings.filter(
    (binding): binding is FileLaunchBinding =>
      binding.direction === "output" &&
      isFileBinding(binding) &&
      binding.name === parameterName &&
      (inputFilePath(binding.filePath).toLowerCase() === fileName ||
        inputFileStem(binding.filePath).toLowerCase() === fileName),
  );
}

export function resolveInputReferences(
  bindings: LaunchBinding[],
): InputReferenceResolution {
  const inputs = bindings.filter(
    (binding) => binding.direction === "input",
  );
  const roots = new Map<string, LaunchBinding>();
  const errors = new Map<string, string>();
  for (const binding of inputs) {
    if (!binding.inputReference?.trim()) {
      roots.set(parameterKey(binding), binding);
      continue;
    }
    const path: LaunchBinding[] = [];
    const visited = new Set<string>();
    let current: LaunchBinding | undefined = binding;
    while (current) {
      const currentKey = parameterKey(current);
      if (visited.has(currentKey)) {
        errors.set(
          parameterKey(binding),
          `参数“${binding.name}”存在循环引用。`,
        );
        break;
      }
      visited.add(currentKey);
      path.push(current);
      if (!current.inputReference?.trim()) {
        for (const pathBinding of path) {
          roots.set(parameterKey(pathBinding), current);
        }
        break;
      }
      const reference = parseParameterReference(current.inputReference);
      if (!reference || reference.direction !== "input") {
        errors.set(
          parameterKey(binding),
          `参数“${current.name}”的引用格式无效，应为 @文件名[In].参数名。`,
        );
        break;
      }
      const matches = referencedInputBindings(
        current.inputReference,
        inputs,
      );
      if (matches.length > 1) {
        errors.set(
          parameterKey(binding),
          `参数引用 ${current.inputReference} 对应多个输入参数，请使用唯一的文件名和参数名。`,
        );
        break;
      }
      current = matches[0];
      if (!current) {
        errors.set(
          parameterKey(binding),
          `参数“${path.at(-1)?.name ?? binding.name}”引用了不存在的输入参数 ${path.at(-1)?.inputReference ?? ""}。`,
        );
      }
    }
  }
  for (const binding of inputs) {
    const root = roots.get(parameterKey(binding));
    const bindingKey = parameterKey(binding);
    if (
      root &&
      parameterKey(root) !== bindingKey &&
      root.parameterType !== binding.parameterType
    ) {
      errors.set(
        bindingKey,
        `参数“${binding.name}”与引用参数“${root.name}”的类型不一致。`,
      );
    }
  }
  return { roots, errors };
}

export function inferParameterType(value: string): LaunchParameterType {
  const trimmed = value.trim();
  if (/^(?:true|false)$/i.test(trimmed)) return "boolean";
  if (NUMBER_PATTERN.test(trimmed)) return "number";
  return "text";
}

export function normalizeParameterType(
  value: unknown,
  fallbackValue = "",
): LaunchParameterType {
  return isLaunchParameterType(value)
    ? (value as LaunchParameterType)
    : inferParameterType(fallbackValue);
}

export function isLaunchParameterType(
  value: unknown,
): value is LaunchParameterType {
  return LAUNCH_PARAMETER_TYPES.includes(value as LaunchParameterType);
}

export function validateParameterValue(
  type: LaunchParameterType,
  value: string,
): string | null {
  const trimmed = value.trim();
  if (type === "number" && !NUMBER_PATTERN.test(trimmed)) {
    return "必须是有效数值。";
  }
  if (type === "boolean" && !/^(?:true|false)$/i.test(trimmed)) {
    return "必须是 true 或 false。";
  }
  if (type === "path" && !trimmed) {
    return "路径不能为空。";
  }
  return null;
}

export function parameterFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

export const FREE_PARAMETER_SCOPE = "自由参数";

export function parameterKey(binding: LaunchBinding): string {
  return binding.scope === "free"
    ? `${FREE_PARAMETER_SCOPE}.${binding.name}`
    : `${parameterFileName(binding.filePath)}.${binding.name}`;
}

interface LaunchBindingBase {
  name: string;
  direction: LaunchBindingDirection;
  outputName?: string;
  inputReference?: string;
  outputReference?: string;
  locatorInvalid?: boolean;
  locatorInvalidAnchor?: number;
  value: string;
  parameterType: LaunchParameterType;
  defaultValue: string;
  unit: string;
  description: string;
}

export interface FileLaunchBinding extends LaunchBindingBase {
  scope?: "file";
  filePath: string;
  locator: LaunchLocator;
}

export interface FreeLaunchBinding extends LaunchBindingBase {
  scope: "free";
  filePath?: never;
  locator?: never;
}

export type LaunchBinding = FileLaunchBinding | FreeLaunchBinding;

export function isFileBinding(
  binding: LaunchBinding,
): binding is FileLaunchBinding {
  return binding.scope !== "free";
}

export function isFreeBinding(
  binding: LaunchBinding,
): binding is FreeLaunchBinding {
  return binding.scope === "free";
}

export interface ResolvedLaunchBinding {
  start: number;
  end: number;
  value: string;
}

export interface BindingError {
  parameterKey: string;
  message: string;
}

export interface WriteBindingsResult {
  source: string;
  bindings: LaunchBinding[];
  writtenParameterKeys: string[];
  errors: BindingError[];
}

export interface OutputExtraction {
  parameterKey: string;
  fileName: string;
  name: string;
  filePath?: string;
  value: string | null;
  range: SourceRange | null;
  error: string | null;
}

export class LauncherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LauncherError";
  }
}

interface LineEntry {
  start: number;
  end: number;
  text: string;
}

function sourceLines(source: string): LineEntry[] {
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

interface SpecialCharacterToken {
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

function tokenRangeForSelection(
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

function resolveRowColumnLocator(
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

function resolveAutoPositionLocator(
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

function lineAt(source: string, rowIndex: number): LineEntry {
  const line = sourceLines(source)[rowIndex - 1];
  if (!line) {
    throw new LauncherError(`第 ${rowIndex} 行不存在。`);
  }
  return line;
}

function trimmedRange(
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

function resolveStartColumnLocator(
  source: string,
  locator: StartColumnLaunchLocator,
): ResolvedLaunchBinding {
  const line = lineAt(source, locator.rowIndex);
  const startColumn = Math.min(
    locator.startColumnIndex,
    line.text.length,
  );
  return trimmedRange(
    source,
    line.start + startColumn,
    line.end,
  );
}

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

function resolveMarkerLocator(
  source: string,
  locator: MarkerLaunchLocator,
): ResolvedLaunchBinding {
  if (!locator.startMarker || !locator.endMarker) {
    throw new LauncherError("不定行定位必须填写起始和结束标记。");
  }
  let startIndex = -1;
  let cursor = 0;
  for (let index = 0; index <= locator.occurrence; index += 1) {
    startIndex = source.indexOf(locator.startMarker, cursor);
    if (startIndex < 0) break;
    cursor = startIndex + locator.startMarker.length;
  }
  if (startIndex < 0) {
    throw new LauncherError("未找到起始标记。");
  }
  const contentStart = startIndex + locator.startMarker.length;
  const endIndex = source.indexOf(locator.endMarker, contentStart);
  if (endIndex < 0) {
    throw new LauncherError("未找到结束标记。");
  }
  return trimmedRange(source, contentStart, endIndex);
}

function resolvePatternLocator(
  source: string,
  locator: PatternLaunchLocator,
): ResolvedLaunchBinding {
  if (!locator.pattern) {
    throw new LauncherError("模式匹配必须填写正则表达式。");
  }
  const flags = new Set(locator.flags.replace(/[^gimsuyd]/g, "").split(""));
  flags.add("g");
  flags.add("d");
  let regex: RegExp;
  try {
    regex = new RegExp(locator.pattern, [...flags].join(""));
  } catch (error) {
    throw new LauncherError(
      `正则表达式无效：${error instanceof Error ? error.message : "未知错误"}`,
    );
  }
  let match: RegExpExecArray | null = null;
  for (let index = 0; index <= locator.occurrence; index += 1) {
    match = regex.exec(source);
    if (!match) break;
  }
  if (!match) {
    throw new LauncherError("模式匹配没有找到结果。");
  }
  if (
    !Number.isInteger(locator.captureGroup) ||
    locator.captureGroup < 0 ||
    locator.captureGroup >= match.length
  ) {
    throw new LauncherError(
      `捕获组 ${locator.captureGroup} 不存在。`,
    );
  }
  const range = match.indices?.[locator.captureGroup];
  if (!range) {
    throw new LauncherError("正则捕获组没有匹配文本。");
  }
  return {
    start: range[0],
    end: range[1],
    value: source.slice(range[0], range[1]),
  };
}

type JsonPathSegment = string | number;

function parseJsonPath(path: string): JsonPathSegment[] {
  let cursor = path.trim();
  if (cursor.startsWith("$")) cursor = cursor.slice(1);
  const segments: JsonPathSegment[] = [];
  while (cursor.length > 0) {
    if (cursor.startsWith(".")) {
      cursor = cursor.slice(1);
      const match = /^[A-Za-z_$][\w$.-]*/.exec(cursor);
      if (!match) throw new LauncherError("JSON 路径字段名无效。");
      for (const part of match[0].split(".")) {
        if (part) segments.push(part);
      }
      cursor = cursor.slice(match[0].length);
      continue;
    }
    if (cursor.startsWith("[")) {
      const end = cursor.indexOf("]");
      if (end < 0) throw new LauncherError("JSON 路径缺少右方括号。");
      const token = cursor.slice(1, end).trim();
      if (/^\d+$/.test(token)) {
        segments.push(Number(token));
      } else if (
        (token.startsWith('"') && token.endsWith('"')) ||
        (token.startsWith("'") && token.endsWith("'"))
      ) {
        segments.push(token.slice(1, -1));
      } else {
        throw new LauncherError(`不支持的 JSON 路径片段：[${token}]`);
      }
      cursor = cursor.slice(end + 1);
      continue;
    }
    const match = /^[A-Za-z_$][\w$]*/.exec(cursor);
    if (!match) throw new LauncherError(`JSON 路径无效：${path}`);
    segments.push(match[0]);
    cursor = cursor.slice(match[0].length);
  }
  return segments;
}

function skipJsonWhitespace(source: string, index: number): number {
  let cursor = index;
  while (cursor < source.length && /\s/.test(source[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function skipJsonString(source: string, index: number): number {
  let cursor = index + 1;
  let escaped = false;
  while (cursor < source.length) {
    const character = source[cursor];
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (character === '"') return cursor + 1;
    cursor += 1;
  }
  throw new LauncherError("JSON 字符串未闭合。");
}

function skipJsonValue(source: string, index: number): number {
  const start = skipJsonWhitespace(source, index);
  const first = source[start];
  if (first === '"') return skipJsonString(source, start);
  if (first !== "{" && first !== "[") {
    let cursor = start;
    while (
      cursor < source.length &&
      !/[,}\]\s]/.test(source[cursor])
    ) {
      cursor += 1;
    }
    return cursor;
  }
  const closing = first === "{" ? "}" : "]";
  let depth = 0;
  let cursor = start;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === '"') {
      cursor = skipJsonString(source, cursor);
      continue;
    }
    if (character === first) depth += 1;
    if (character === closing) {
      depth -= 1;
      if (depth === 0) return cursor + 1;
    }
    cursor += 1;
  }
  throw new LauncherError("JSON 结构未闭合。");
}

function findJsonObjectKey(
  source: string,
  objectStart: number,
  key: string,
): number | null {
  let cursor = skipJsonWhitespace(source, objectStart + 1);
  while (cursor < source.length && source[cursor] !== "}") {
    if (source[cursor] !== '"') {
      throw new LauncherError("JSON 对象键格式无效。");
    }
    const keyEnd = skipJsonString(source, cursor);
    const decodedKey = JSON.parse(source.slice(cursor, keyEnd)) as string;
    cursor = skipJsonWhitespace(source, keyEnd);
    if (source[cursor] !== ":") {
      throw new LauncherError("JSON 对象缺少冒号。");
    }
    cursor = skipJsonWhitespace(source, cursor + 1);
    if (decodedKey === key) return cursor;
    cursor = skipJsonWhitespace(source, skipJsonValue(source, cursor));
    if (source[cursor] !== ",") break;
    cursor = skipJsonWhitespace(source, cursor + 1);
  }
  return null;
}

function findJsonArrayItem(
  source: string,
  arrayStart: number,
  itemIndex: number,
): number | null {
  let cursor = skipJsonWhitespace(source, arrayStart + 1);
  let index = 0;
  while (cursor < source.length && source[cursor] !== "]") {
    if (index === itemIndex) return cursor;
    cursor = skipJsonWhitespace(source, skipJsonValue(source, cursor));
    if (source[cursor] !== ",") break;
    cursor = skipJsonWhitespace(source, cursor + 1);
    index += 1;
  }
  return null;
}

function resolveJsonPathLocator(
  source: string,
  locator: JsonPathLaunchLocator,
): ResolvedLaunchBinding {
  const segments = parseJsonPath(locator.path);
  if (segments.length === 0) {
    throw new LauncherError("JSON 路径不能为空。");
  }
  let valueStart = skipJsonWhitespace(source, 0);
  for (const segment of segments) {
    valueStart = skipJsonWhitespace(source, valueStart);
    if (typeof segment === "number") {
      if (source[valueStart] !== "[") {
        throw new LauncherError(`JSON 路径段 [${segment}] 要求数组。`);
      }
      const next = findJsonArrayItem(source, valueStart, segment);
      if (next === null) {
        throw new LauncherError(`JSON 数组不存在索引 ${segment}。`);
      }
      valueStart = next;
      continue;
    }
    if (source[valueStart] !== "{") {
      throw new LauncherError(`JSON 路径段“${segment}”要求对象。`);
    }
    const next = findJsonObjectKey(source, valueStart, segment);
    if (next === null) {
      throw new LauncherError(`JSON 对象不存在键“${segment}”。`);
    }
    valueStart = next;
  }
  const valueEnd = skipJsonValue(source, valueStart);
  const raw = source.slice(valueStart, valueEnd);
  let value: string;
  try {
    const parsed = JSON.parse(raw) as unknown;
    value =
      typeof parsed === "string" ? parsed : JSON.stringify(parsed);
  } catch {
    throw new LauncherError("JSON 路径定位到了无效值。");
  }
  return { start: valueStart, end: valueEnd, value };
}

interface XmlElementFrame {
  name: string;
  path: Array<{ name: string; index: number }>;
  contentStart: number;
  endTagStart: number | null;
  attributes: Map<string, { start: number; end: number; value: string }>;
}

function parseXmlStartTag(
  source: string,
  start: number,
  end: number,
): {
  name: string;
  selfClosing: boolean;
  attributes: Map<string, { start: number; end: number; value: string }>;
} {
  const text = source.slice(start, end);
  const nameMatch = /^<\s*([A-Za-z_][\w:.-]*)/.exec(text);
  if (!nameMatch) throw new LauncherError("XML 起始标签无效。");
  const attributes = new Map<
    string,
    { start: number; end: number; value: string }
  >();
  const attributePattern =
    /([A-Za-z_][\w:.-]*)\s*=\s*(["'])([\s\S]*?)\2/g;
  let match: RegExpExecArray | null;
  while ((match = attributePattern.exec(text)) !== null) {
    const valueOffset = match.index + match[0].lastIndexOf(match[3]);
    attributes.set(match[1], {
      start: start + valueOffset,
      end: start + valueOffset + match[3].length,
      value: decodeXmlEntities(match[3]),
    });
  }
  return {
    name: nameMatch[1],
    selfClosing: /\/\s*>$/.test(text),
    attributes,
  };
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function resolveXmlPathLocator(
  source: string,
  locator: XmlPathLaunchLocator,
): ResolvedLaunchBinding {
  const path = locator.path.trim().replace(/^\/+/, "");
  if (!path) throw new LauncherError("XML 路径不能为空。");
  const targetAttribute = /\/@([A-Za-z_][\w:.-]*)$/.exec(path);
  const targetText = /\/text\(\)$/.test(path);
  const elementPath = targetAttribute
    ? path.slice(0, targetAttribute.index)
    : targetText
      ? path.slice(0, -"/text()".length)
      : path;
  const segments = elementPath.split("/").filter(Boolean).map((entry) => {
    const match = /^([A-Za-z_][\w:.-]*)(?:\[(\d+)\])?$/.exec(entry);
    if (!match) throw new LauncherError(`XML 路径片段无效：${entry}`);
    return { name: match[1], index: Number(match[2] ?? 1) };
  });
  if (segments.length === 0) throw new LauncherError("XML 路径不能为空。");

  const stack: XmlElementFrame[] = [];
  const completed: XmlElementFrame[] = [];
  const childCounts = new Map<string, Map<string, number>>();
  let cursor = 0;
  while (cursor < source.length) {
    const tagStart = source.indexOf("<", cursor);
    if (tagStart < 0) break;
    if (source.startsWith("<!--", tagStart)) {
      const close = source.indexOf("-->", tagStart + 4);
      if (close < 0) throw new LauncherError("XML 注释未闭合。");
      cursor = close + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", tagStart)) {
      const close = source.indexOf("]]>", tagStart + 9);
      if (close < 0) throw new LauncherError("XML CDATA 未闭合。");
      cursor = close + 3;
      continue;
    }
    if (source.startsWith("<?", tagStart)) {
      const close = source.indexOf("?>", tagStart + 2);
      if (close < 0) throw new LauncherError("XML 声明未闭合。");
      cursor = close + 2;
      continue;
    }
    let tagEnd = tagStart + 1;
    let quote: string | null = null;
    while (tagEnd < source.length) {
      const character = source[tagEnd];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        break;
      }
      tagEnd += 1;
    }
    if (tagEnd >= source.length) throw new LauncherError("XML 标签未闭合。");
    const tagText = source.slice(tagStart, tagEnd + 1);
    if (/^<\//.test(tagText)) {
      const name = /^<\/\s*([A-Za-z_][\w:.-]*)/.exec(tagText)?.[1];
      const frame = stack.pop();
      if (!frame || !name || frame.name !== name) {
        throw new LauncherError(`XML 结束标签不匹配：${name ?? "未知"}`);
      }
      frame.endTagStart = tagStart;
      completed.push(frame);
      cursor = tagEnd + 1;
      continue;
    }
    const parsed = parseXmlStartTag(source, tagStart, tagEnd + 1);
    const parent = stack.at(-1);
    const parentKey = parent
      ? parent.path.map((entry) => `${entry.name}[${entry.index}]`).join("/")
      : "";
    const counts = childCounts.get(parentKey) ?? new Map<string, number>();
    const nextIndex = (counts.get(parsed.name) ?? 0) + 1;
    counts.set(parsed.name, nextIndex);
    childCounts.set(parentKey, counts);
    const frame: XmlElementFrame = {
      name: parsed.name,
      path: [
        ...(parent?.path ?? []),
        { name: parsed.name, index: nextIndex },
      ],
      contentStart: tagEnd + 1,
      endTagStart: parsed.selfClosing ? tagEnd + 1 : null,
      attributes: parsed.attributes,
    };
    if (parsed.selfClosing) completed.push(frame);
    else stack.push(frame);
    cursor = tagEnd + 1;
  }

  const element = completed.find(
    (candidate) =>
      candidate.path.length === segments.length &&
      candidate.path.every(
        (entry, index) =>
          entry.name === segments[index].name &&
          entry.index === segments[index].index,
      ),
  );
  if (!element) throw new LauncherError("XML 路径没有找到对应元素。");
  if (targetAttribute) {
    const attribute = element.attributes.get(targetAttribute[1]);
    if (!attribute) {
      throw new LauncherError(
        `元素 ${element.name} 不存在属性 ${targetAttribute[1]}。`,
      );
    }
    return {
      start: attribute.start,
      end: attribute.end,
      value: attribute.value,
    };
  }
  if (element.endTagStart === null) {
    throw new LauncherError("XML 元素没有文本内容。");
  }
  return trimmedRange(source, element.contentStart, element.endTagStart);
}

export function createLaunchFile(
  path: string,
  content: string,
  sourcePath?: string,
): LaunchFile {
  const normalizedPath = path.trim();
  const normalizedSourcePath = sourcePath?.trim() || undefined;
  const slash = Math.max(
    normalizedPath.lastIndexOf("/"),
    normalizedPath.lastIndexOf("\\"),
  );
  return {
    path: normalizedPath,
    ...(normalizedSourcePath
      ? {
          sourcePath: normalizedSourcePath,
          sourceContent: content,
        }
      : {}),
    name: normalizedPath.slice(slash + 1) || normalizedPath,
    content,
    flavor: sourceFlavorFromFilename(normalizedPath),
    size: new Blob([content]).size,
  };
}

export function resolveLaunchBinding(
  source: string,
  locator: LaunchLocator,
): ResolvedLaunchBinding {
  switch (locator.kind) {
    case "autoPosition":
      return resolveAutoPositionLocator(source, locator);
    case "rowColumn":
      return resolveRowColumnLocator(source, locator);
    case "startColumn":
      return resolveStartColumnLocator(source, locator);
    case "wholeLine":
      return resolveWholeLineLocator(source, locator);
    case "multiLine":
      return resolveMultiLineLocator(source, locator);
    case "delimited":
      return resolveDelimitedLocator(source, locator);
    case "marker":
      return resolveMarkerLocator(source, locator);
    case "jsonPath":
      return resolveJsonPathLocator(source, locator);
    case "xmlPath":
      return resolveXmlPathLocator(source, locator);
    case "pattern":
      return resolvePatternLocator(source, locator);
    default:
      throw new LauncherError("不支持的定位模式。");
  }
}

export function createBindingFromSelection(
  file: LaunchFile,
  selection: SourceRange,
  direction: LaunchBindingDirection,
  name?: string,
): LaunchBinding {
  if (selection.end <= selection.start) {
    throw new LauncherError("请先在文件中选中要绑定的内容。");
  }
  if (
    selection.start < 0 ||
    selection.end > file.content.length
  ) {
    throw new LauncherError("选区已失效，请重新选择。");
  }

  const selectedText = file.content.slice(selection.start, selection.end);
  const suggestedName = selectedText.trim();
  const locator = createAutoPositionLocator(file, selection);
  const resolved = resolveLaunchBinding(file.content, locator);
  const value = resolved.value;
  return {
    name: name?.trim() || suggestedName.slice(0, 40) || "未命名参数",
    direction,
    filePath: file.path,
    locator,
    value,
    parameterType: inferParameterType(value),
    defaultValue: value,
    unit: "",
    description: "",
  };
}

export function createAutoPositionLocator(
  file: LaunchFile,
  selection: SourceRange,
): AutoPositionLaunchLocator {
  if (selection.end <= selection.start) {
    throw new LauncherError("请先在文件中选中要绑定的内容。");
  }
  if (selection.start < 0 || selection.end > file.content.length) {
    throw new LauncherError("选区已失效，请重新选择。");
  }
  const startLineStart =
    file.content.lastIndexOf("\n", Math.max(0, selection.start - 1)) + 1;
  const lastSelectedIndex = Math.max(selection.start, selection.end - 1);
  const endLineStart =
    file.content.lastIndexOf("\n", Math.max(0, lastSelectedIndex - 1)) + 1;
  const startRowIndex =
    file.content.slice(0, selection.start).split("\n").length;
  const endRowIndex =
    file.content.slice(0, lastSelectedIndex).split("\n").length;
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
    const line = sourceLines(file.content)[startRowIndex - 1];
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

export interface RowColumnParameter {
  startRowIndex: number;
  startColumnIndex: number;
  endRowIndex: number;
  endColumnIndex: number;
}

export interface LocatorModeValues {
  startRowIndex?: number;
  startColumnIndex?: number;
  endRowIndex?: number;
  endColumnIndex?: number;
  separator?: string;
  fieldIndex?: number;
  startMarker?: string;
  endMarker?: string;
  jsonPath?: string;
  xmlPath?: string;
  pattern?: string;
  flags?: string;
  captureGroup?: number;
  occurrence?: number;
}

export function createLocatorForMode(
  mode: Exclude<LaunchLocatorMode, "auto">,
  values: LocatorModeValues,
): LaunchLocator {
  if (mode === "fixedLength") {
    return {
      kind: "rowColumn",
      startRowIndex: values.startRowIndex ?? 1,
      startColumnIndex: values.startColumnIndex ?? 0,
      endRowIndex: values.endRowIndex ?? values.startRowIndex ?? 1,
      endColumnIndex: values.endColumnIndex ?? values.startColumnIndex ?? 0,
    };
  }
  if (mode === "startColumn") {
    return {
      kind: "startColumn",
      rowIndex: values.startRowIndex ?? 1,
      startColumnIndex: values.startColumnIndex ?? 0,
    };
  }
  if (mode === "wholeLine") {
    return {
      kind: "wholeLine",
      rowIndex: values.startRowIndex ?? 1,
    };
  }
  if (mode === "multiLine") {
    return {
      kind: "multiLine",
      startRowIndex: values.startRowIndex ?? 1,
      endRowIndex: values.endRowIndex ?? values.startRowIndex ?? 1,
    };
  }
  if (mode === "delimited") {
    return {
      kind: "delimited",
      rowIndex: values.startRowIndex ?? 1,
      separator: values.separator ?? "",
      fieldIndex: values.fieldIndex ?? 0,
    };
  }
  if (mode === "indefiniteLine") {
    return {
      kind: "marker",
      startMarker: values.startMarker ?? "",
      endMarker: values.endMarker ?? "",
      occurrence: values.occurrence ?? 0,
    };
  }
  if (mode === "jsonPath") {
    return { kind: "jsonPath", path: values.jsonPath ?? "$" };
  }
  if (mode === "xmlPath") {
    return { kind: "xmlPath", path: values.xmlPath ?? "" };
  }
  return {
    kind: "pattern",
    pattern: values.pattern ?? "",
    flags: values.flags ?? "",
    captureGroup: values.captureGroup ?? 0,
    occurrence: values.occurrence ?? 0,
  };
}

export function createBindingFromLocator(
  file: LaunchFile,
  locator: LaunchLocator,
  direction: LaunchBindingDirection,
  name: string,
): LaunchBinding {
  const resolved = resolveLaunchBinding(
    file.content,
    locator,
  );
  const value = resolved.value;
  return {
    name,
    direction,
    filePath: file.path,
    locator,
    value,
    parameterType: inferParameterType(value),
    defaultValue: value,
    unit: "",
    description: "",
  };
}

export function createBindingFromRowColumn(
  file: LaunchFile,
  parameter: RowColumnParameter,
  direction: LaunchBindingDirection,
  name: string,
): LaunchBinding {
  const locator: RowColumnLaunchLocator = {
    kind: "rowColumn",
    startRowIndex: parameter.startRowIndex,
    startColumnIndex: parameter.startColumnIndex,
    endRowIndex: parameter.endRowIndex,
    endColumnIndex: parameter.endColumnIndex,
  };
  const resolved = resolveLaunchBinding(
    file.content,
    locator,
  );
  const value = resolved.value;
  return {
    name,
    direction,
    filePath: file.path,
    locator,
    value,
    parameterType: inferParameterType(value),
    defaultValue: value,
    unit: "",
    description: "",
  };
}

function replacementText(
  source: string,
  locator: LaunchLocator,
  resolved: ResolvedLaunchBinding,
  nextValue: string,
): string {
  if (locator.kind === "jsonPath") {
    const raw = source.slice(resolved.start, resolved.end).trim();
    if (raw.startsWith('"')) return JSON.stringify(nextValue);
    if (/^(?:true|false|null|-?\d)/.test(raw)) return nextValue.trim();
    try {
      return JSON.stringify(JSON.parse(nextValue));
    } catch {
      throw new LauncherError("JSON 对象或数组输入不是有效 JSON。");
    }
  }
  if (locator.kind === "xmlPath") {
    return nextValue
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
  return nextValue;
}

function updatedLocatorAfterWrite(
  source: string,
  locator: LaunchLocator,
  replacement: string,
): LaunchLocator {
  if (locator.kind === "rowColumn") {
    const lines = replacement.split("\n");
    return {
      ...locator,
      endRowIndex:
        locator.startRowIndex + Math.max(0, lines.length - 1),
      endColumnIndex:
        lines.length === 1
          ? locator.startColumnIndex + replacement.length
          : (lines.at(-1)?.length ?? 0),
    };
  }
  if (locator.kind === "autoPosition") {
    const lines = replacement.split("\n");
    const updated: AutoPositionLaunchLocator = {
      ...locator,
      endRowIndex:
        locator.startRowIndex + Math.max(0, lines.length - 1),
      endColumnIndex:
        lines.length === 1
          ? locator.startColumnIndex + replacement.length
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
      const expected = resolveRowColumnLocator(source, fixedLocator);
      const resolved = resolveAutoPositionLocator(source, updated);
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
  }
  return locator;
}

export function writeInputBindings(
  source: string,
  bindings: LaunchBinding[],
): WriteBindingsResult {
  const inputs = bindings.filter(
    (binding): binding is FileLaunchBinding =>
      binding.direction === "input" && isFileBinding(binding),
  );
  if (inputs.length === 0) {
    return {
      source,
      bindings,
      writtenParameterKeys: [],
      errors: [],
    };
  }

  const errors: BindingError[] = [];
  const replacements = inputs.flatMap((binding) => {
    try {
      const valueError = validateParameterValue(
        binding.parameterType,
        binding.value,
      );
      if (valueError) {
        throw new LauncherError(
          `参数“${binding.name}”${valueError}`,
        );
      }
      const resolved = resolveLaunchBinding(source, binding.locator);
      return [
        {
          binding,
          start: resolved.start,
          end: resolved.end,
          text: replacementText(
            source,
            binding.locator,
            resolved,
            binding.value,
          ),
        },
      ];
    } catch (error) {
      errors.push({
        parameterKey: parameterKey(binding),
        message:
          error instanceof Error ? error.message : "输入定位失败。",
      });
      return [];
    }
  });

  if (errors.length > 0) {
    return { source, bindings, writtenParameterKeys: [], errors };
  }

  const sorted = [...replacements].sort(
    (first, second) => second.start - first.start,
  );
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].end > sorted[index - 1].start) {
      errors.push({
        parameterKey: parameterKey(sorted[index].binding),
        message: "多个输入绑定指向重叠的文本范围。",
      });
    }
  }
  if (errors.length > 0) {
    return { source, bindings, writtenParameterKeys: [], errors };
  }

  let nextSource = source;
  for (const replacement of sorted) {
    nextSource =
      nextSource.slice(0, replacement.start) +
      replacement.text +
      nextSource.slice(replacement.end);
  }

  const replacementById = new Map(
    replacements.map((replacement) => [
      parameterKey(replacement.binding),
      replacement.text,
    ]),
  );
  return {
    source: nextSource,
    bindings: bindings.map((binding) => {
      if (!isFileBinding(binding)) return binding;
      const replacement = replacementById.get(parameterKey(binding));
      if (replacement === undefined) return binding;
      return {
        ...binding,
        locator: updatedLocatorAfterWrite(
          nextSource,
          binding.locator,
          replacement,
        ),
      };
    }),
    writtenParameterKeys: inputs.map(parameterKey),
    errors: [],
  };
}

export function extractOutputBindings(
  files: LaunchFile[],
  bindings: LaunchBinding[],
): OutputExtraction[] {
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const fileOutputs: OutputExtraction[] = [];
  for (const binding of bindings) {
    if (binding.direction !== "output" || !isFileBinding(binding)) continue;
    const file = filesByPath.get(binding.filePath);
    if (!file) {
      fileOutputs.push({
        parameterKey: parameterKey(binding),
        fileName: parameterFileName(binding.filePath),
        name: binding.name,
        filePath: binding.filePath,
        value: null,
        range: null,
        error: "输出文件已被移除。",
      });
      continue;
    }
    try {
      const resolved = resolveLaunchBinding(
        file.content,
        binding.locator,
      );
      fileOutputs.push({
        parameterKey: parameterKey(binding),
        fileName: parameterFileName(binding.filePath),
        name: binding.name,
        filePath: binding.filePath,
        value: resolved.value,
        range: { start: resolved.start, end: resolved.end },
        error: null,
      });
    } catch (error) {
      fileOutputs.push({
        parameterKey: parameterKey(binding),
        fileName: parameterFileName(binding.filePath),
        name: binding.name,
        filePath: binding.filePath,
        value: null,
        range: null,
        error:
          error instanceof Error ? error.message : "输出提取失败。",
      });
    }
  }
  const fileOutputByKey = new Map(
    fileOutputs.map((output) => [output.parameterKey, output]),
  );
  const freeOutputs: OutputExtraction[] = [];
  for (const binding of bindings) {
    if (binding.direction !== "output" || !isFreeBinding(binding)) continue;
    const manualValue = binding.value.trim() ? binding.value : null;
    if (!binding.outputReference?.trim()) {
      freeOutputs.push({
        parameterKey: parameterKey(binding),
        fileName: FREE_PARAMETER_SCOPE,
        name: binding.name,
        value: manualValue,
        range: null,
        error: null,
      });
      continue;
    }
    const matches = referencedOutputBindings(
      binding.outputReference,
      bindings,
    );
    if (matches.length > 1) {
      freeOutputs.push({
        parameterKey: parameterKey(binding),
        fileName: FREE_PARAMETER_SCOPE,
        name: binding.name,
        value: manualValue,
        range: null,
        error: `输出引用 ${binding.outputReference} 对应多个输出参数。`,
      });
      continue;
    }
    const target = matches[0]
      ? fileOutputByKey.get(parameterKey(matches[0]))
      : undefined;
    if (!target || target.value === null || target.error) {
      freeOutputs.push({
        parameterKey: parameterKey(binding),
        fileName: FREE_PARAMETER_SCOPE,
        name: binding.name,
        value: manualValue,
        range: null,
        error:
          manualValue !== null
            ? null
            : target?.error ??
              `未找到输出引用 ${binding.outputReference}。`,
      });
      continue;
    }
    freeOutputs.push({
      parameterKey: parameterKey(binding),
      fileName: FREE_PARAMETER_SCOPE,
      name: binding.name,
      value: target.value,
      range: null,
      error: null,
    });
  }
  return [...fileOutputs, ...freeOutputs];
}

export function parseCommandArguments(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let hasContent = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      hasContent = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      hasContent = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (hasContent) {
        args.push(current);
        current = "";
        hasContent = false;
      }
      continue;
    }
    current += character;
    hasContent = true;
  }
  if (quote) {
    throw new LauncherError("参数中存在未闭合的引号。");
  }
  if (hasContent) args.push(current);
  return args;
}

export function interpolateArguments(
  args: string[],
  bindings: LaunchBinding[],
): string[] {
  if (args.some((argument) => /\{\{[^{}]+\}\}/.test(argument))) {
    throw new LauncherError(
      "启动参数只支持 @文件名[In].参数名 语法，不支持 {{参数名}}。",
    );
  }
  const resolution = resolveInputReferences(bindings);
  const referenceError = [...resolution.errors.values()][0];
  if (referenceError) throw new LauncherError(referenceError);
  const errors = new Set<string>();
  const lookupReference = (rawReference: string): string => {
    const matches = referencedInputBindings(
      `@${rawReference.trim()}`,
      bindings,
    );
    if (matches.length === 0) {
      errors.add(`未找到输入参数 @${rawReference}。`);
      return `@${rawReference}`;
    }
    if (matches.length > 1) {
      errors.add(`输入参数 @${rawReference} 对应多个绑定，请使用唯一参数名。`);
      return `@${rawReference}`;
    }
    return (
      resolution.roots.get(parameterKey(matches[0]))?.value ??
      matches[0].value
    );
  };
  const interpolated = args.map((argument) =>
    argument
      .replace(
        /(^|[\s=,:])@([^\s"'`,;]+\[In\]\.[^\s"'`,;]+)/gi,
        (_placeholder, prefix: string, rawReference: string) =>
          `${prefix}${lookupReference(rawReference)}`,
      ),
  );
  if (errors.size > 0) {
    throw new LauncherError([...errors].join("；"));
  }
  return interpolated;
}

function quoteCommandArgument(argument: string): string {
  if (argument && !/[\s"]/u.test(argument)) return argument;
  return `"${argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1")}"`;
}

export function buildLaunchCommand(
  program: string,
  argumentText: string,
  bindings: LaunchBinding[],
): string {
  if (!program.trim()) return "";
  const args = interpolateArguments(
    parseCommandArguments(argumentText),
    bindings,
  );
  return [program.trim(), ...args].map(quoteCommandArgument).join(" ");
}
