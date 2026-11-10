import type {
  LaunchLocator,
  LaunchLocatorMode,
  LocatorCreateContext,
  LocatorKind,
  LocatorModeValues,
  LocatorStrategy,
} from "./model.ts";
import { autoPositionLocatorStrategy } from "./strategies/autoPosition.ts";
import { delimitedLocatorStrategy } from "./strategies/delimited.ts";
import { jsonPathLocatorStrategy } from "./strategies/jsonPath.ts";
import { markerLocatorStrategy } from "./strategies/marker.ts";
import { multiLineLocatorStrategy } from "./strategies/multiLine.ts";
import { patternLocatorStrategy } from "./strategies/pattern.ts";
import { rowColumnLocatorStrategy } from "./strategies/rowColumn.ts";
import { startColumnLocatorStrategy } from "./strategies/startColumn.ts";
import { wholeLineLocatorStrategy } from "./strategies/wholeLine.ts";
import { xmlPathLocatorStrategy } from "./strategies/xmlPath.ts";

const LOCATOR_STRATEGIES = {
  autoPosition: autoPositionLocatorStrategy,
  rowColumn: rowColumnLocatorStrategy,
  startColumn: startColumnLocatorStrategy,
  wholeLine: wholeLineLocatorStrategy,
  multiLine: multiLineLocatorStrategy,
  delimited: delimitedLocatorStrategy,
  marker: markerLocatorStrategy,
  jsonPath: jsonPathLocatorStrategy,
  xmlPath: xmlPathLocatorStrategy,
  pattern: patternLocatorStrategy,
} satisfies {
  [K in LocatorKind]: LocatorStrategy<K>;
};

const MODE_TO_KIND = {
  auto: "autoPosition",
  fixedLength: "rowColumn",
  delimited: "delimited",
  startColumn: "startColumn",
  wholeLine: "wholeLine",
  multiLine: "multiLine",
  indefiniteLine: "marker",
  jsonPath: "jsonPath",
  xmlPath: "xmlPath",
  pattern: "pattern",
} satisfies Record<LaunchLocatorMode, LocatorKind>;

const LOCATOR_MODE_ORDER: LaunchLocatorMode[] = [
  "auto",
  "fixedLength",
  "delimited",
  "startColumn",
  "wholeLine",
  "multiLine",
  "indefiniteLine",
  "jsonPath",
  "xmlPath",
  "pattern",
];

export const LOCATOR_MODE_OPTIONS: ReadonlyArray<{
  value: LaunchLocatorMode;
  label: string;
}> = LOCATOR_MODE_ORDER.map((mode) => ({
  value: mode,
  label: locatorStrategyForMode(mode).optionLabel,
}));

export const LOCATOR_KINDS: ReadonlyArray<LocatorKind> = [
  "autoPosition",
  "rowColumn",
  "startColumn",
  "wholeLine",
  "multiLine",
  "delimited",
  "marker",
  "jsonPath",
  "xmlPath",
  "pattern",
];

export function locatorStrategyForKind<K extends LocatorKind>(
  kind: K,
): LocatorStrategy<K> {
  return LOCATOR_STRATEGIES[kind] as LocatorStrategy<K>;
}

export function locatorStrategyForMode(
  mode: LaunchLocatorMode,
): LocatorStrategy<LocatorKind> {
  return LOCATOR_STRATEGIES[MODE_TO_KIND[mode]] as LocatorStrategy<LocatorKind>;
}

export function locatorKindForMode(mode: LaunchLocatorMode): LocatorKind {
  return MODE_TO_KIND[mode];
}

export function createLocatorForStrategyMode(
  mode: LaunchLocatorMode,
  values: LocatorModeValues,
  context?: LocatorCreateContext,
): LaunchLocator {
  return locatorStrategyForMode(mode).create(values, context);
}

export function isLocatorKind(value: string): value is LocatorKind {
  return Object.hasOwn(LOCATOR_STRATEGIES, value);
}
