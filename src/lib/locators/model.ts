import type { SourceRange } from "../variables.ts";

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

export type LocatorKind = LaunchLocator["kind"];
export type LocatorOfKind<K extends LocatorKind> = Extract<
  LaunchLocator,
  { kind: K }
>;

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

export interface ResolvedLaunchBinding {
  start: number;
  end: number;
  value: string;
}

export interface LocatorDetail {
  label: string;
  value: string;
}

export interface LocatorEditorState {
  mode: LaunchLocatorMode;
  values: LocatorModeValues;
}

export interface LocatorCreateContext {
  content?: string;
  selection?: SourceRange;
}

export interface SourceTextChange {
  from: number;
  to: number;
  insert: string;
}

export interface LocatorRelocationContext {
  previousContent: string;
  changes: readonly SourceTextChange[];
  mapRow(rowIndex: number): number | null;
}

export interface LocatorReplacementContext {
  source: string;
  resolved: ResolvedLaunchBinding;
  nextValue: string;
}

export interface LocatorWriteContext {
  source: string;
  replacement: string;
}

export interface LocatorStrategy<K extends LocatorKind> {
  readonly kind: K;
  readonly mode: LaunchLocatorMode;
  readonly optionLabel: string;

  create(
    values: LocatorModeValues,
    context?: LocatorCreateContext,
  ): LocatorOfKind<K>;
  toEditorState(locator: LocatorOfKind<K>): LocatorEditorState;
  resolve(
    source: string,
    locator: LocatorOfKind<K>,
  ): ResolvedLaunchBinding;
  relocate(
    context: LocatorRelocationContext,
    locator: LocatorOfKind<K>,
  ): LocatorOfKind<K> | null;
  formatReplacement(
    context: LocatorReplacementContext,
    locator: LocatorOfKind<K>,
  ): string;
  afterWrite(
    context: LocatorWriteContext,
    locator: LocatorOfKind<K>,
  ): LocatorOfKind<K>;
  summary(locator: LocatorOfKind<K>): string;
  details(locator: LocatorOfKind<K>): LocatorDetail[];
}
