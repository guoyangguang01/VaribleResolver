import { LauncherError } from "../errors.ts";
import type {
  LocatorStrategy,
  PatternLaunchLocator,
  ResolvedLaunchBinding,
} from "../model.ts";

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

export const patternLocatorStrategy: LocatorStrategy<"pattern"> = {
  kind: "pattern",
  mode: "pattern",
  optionLabel: "模式匹配",
  create(values) {
    return {
      kind: "pattern",
      pattern: values.pattern ?? "",
      flags: values.flags ?? "",
      captureGroup: values.captureGroup ?? 0,
      occurrence: values.occurrence ?? 0,
    };
  },
  toEditorState(locator) {
    return {
      mode: "pattern",
      values: {
        pattern: locator.pattern,
        flags: locator.flags,
        captureGroup: locator.captureGroup,
        occurrence: locator.occurrence,
      },
    };
  },
  resolve: resolvePatternLocator,
  relocate(_context, locator) {
    return locator;
  },
  formatReplacement(context) {
    return context.nextValue;
  },
  afterWrite(_context, locator) {
    return locator;
  },
  summary(locator) {
    return `模式 · /${locator.pattern}/`;
  },
  details(locator) {
    return [
      { label: "正则表达式", value: locator.pattern },
      { label: "标志", value: locator.flags || "无" },
      { label: "捕获组", value: String(locator.captureGroup) },
      { label: "匹配序号", value: String(locator.occurrence) },
    ];
  },
};
