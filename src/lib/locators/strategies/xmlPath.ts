import { LauncherError } from "../errors.ts";
import type {
  LocatorStrategy,
  ResolvedLaunchBinding,
  XmlPathLaunchLocator,
} from "../model.ts";
import { trimmedRange } from "../shared.ts";

interface XmlElementFrame {
  name: string;
  path: Array<{ name: string; index: number }>;
  contentStart: number;
  endTagStart: number | null;
  attributes: Map<string, { start: number; end: number; value: string }>;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
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

export const xmlPathLocatorStrategy: LocatorStrategy<"xmlPath"> = {
  kind: "xmlPath",
  mode: "xmlPath",
  optionLabel: "XML 路径",
  create(values) {
    return { kind: "xmlPath", path: values.xmlPath ?? "" };
  },
  toEditorState(locator) {
    return {
      mode: "xmlPath",
      values: { xmlPath: locator.path },
    };
  },
  resolve: resolveXmlPathLocator,
  relocate(_context, locator) {
    return locator;
  },
  formatReplacement(context) {
    return context.nextValue
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  },
  afterWrite(_context, locator) {
    return locator;
  },
  summary(locator) {
    return `XML · ${locator.path}`;
  },
  details(locator) {
    return [{ label: "XML 路径", value: locator.path }];
  },
};
