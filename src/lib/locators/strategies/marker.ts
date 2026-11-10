import { LauncherError } from "../errors.ts";
import type {
  LocatorStrategy,
  MarkerLaunchLocator,
  ResolvedLaunchBinding,
} from "../model.ts";
import { trimmedRange } from "../shared.ts";

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

export const markerLocatorStrategy: LocatorStrategy<"marker"> = {
  kind: "marker",
  mode: "indefiniteLine",
  optionLabel: "不定行",
  create(values) {
    return {
      kind: "marker",
      startMarker: values.startMarker ?? "",
      endMarker: values.endMarker ?? "",
      occurrence: values.occurrence ?? 0,
    };
  },
  toEditorState(locator) {
    return {
      mode: "indefiniteLine",
      values: {
        startMarker: locator.startMarker,
        endMarker: locator.endMarker,
        occurrence: locator.occurrence,
      },
    };
  },
  resolve: resolveMarkerLocator,
  relocate(_context, locator) {
    return locator;
  },
  formatReplacement(context) {
    return context.nextValue;
  },
  afterWrite(_context, locator) {
    return locator;
  },
  summary() {
    return "不定行 · 标记范围";
  },
  details(locator) {
    return [
      { label: "起始标记", value: locator.startMarker },
      { label: "结束标记", value: locator.endMarker },
      { label: "匹配序号", value: String(locator.occurrence) },
    ];
  },
};
