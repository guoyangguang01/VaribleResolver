import { LauncherError } from "../errors.ts";
import type {
  JsonPathLaunchLocator,
  LocatorStrategy,
  ResolvedLaunchBinding,
} from "../model.ts";

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

export const jsonPathLocatorStrategy: LocatorStrategy<"jsonPath"> = {
  kind: "jsonPath",
  mode: "jsonPath",
  optionLabel: "JSON 路径",
  create(values) {
    return { kind: "jsonPath", path: values.jsonPath ?? "$" };
  },
  toEditorState(locator) {
    return {
      mode: "jsonPath",
      values: { jsonPath: locator.path },
    };
  },
  resolve: resolveJsonPathLocator,
  relocate(_context, locator) {
    return locator;
  },
  formatReplacement(context) {
    const raw = context.source
      .slice(context.resolved.start, context.resolved.end)
      .trim();
    if (raw.startsWith('"')) return JSON.stringify(context.nextValue);
    if (/^(?:true|false|null|-?\d)/.test(raw)) {
      return context.nextValue.trim();
    }
    try {
      return JSON.stringify(JSON.parse(context.nextValue));
    } catch {
      throw new LauncherError("JSON 对象或数组输入不是有效 JSON。");
    }
  },
  afterWrite(_context, locator) {
    return locator;
  },
  summary(locator) {
    return `JSON · ${locator.path}`;
  },
  details(locator) {
    return [{ label: "JSON 路径", value: locator.path }];
  },
};
