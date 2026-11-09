import {
  isFileBinding,
  parameterKey,
  resolveLaunchBinding,
  type FileLaunchBinding,
  type LaunchBinding,
  type LaunchLocator,
} from "./launcher.ts";

export interface SourceTextChange {
  from: number;
  to: number;
  insert: string;
}

export interface SourceEditorChange {
  value: string;
  changes: SourceTextChange[];
}

export interface RelocationResult {
  bindings: LaunchBinding[];
  invalidatedParameterKeys: string[];
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
  changes: SourceTextChange[],
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

function mapRow(
  rowIndex: number,
  starts: number[],
  previousContent: string,
  changes: SourceTextChange[],
): number | null {
  const anchor = starts[rowIndex - 1];
  if (anchor === undefined) return null;
  const mapped = rowIndex + rowDeltaBefore(
    previousContent,
    changes,
    anchor,
  );
  return mapped >= 1 ? mapped : null;
}

function mapPositionThroughChanges(
  position: number,
  changes: SourceTextChange[],
): number {
  let shift = 0;
  for (const change of changes) {
    const newStart = change.from + shift;
    const newEnd = newStart + change.insert.length;
    if (position < change.from) return position + shift;
    if (position > change.to) {
      shift += change.insert.length - (change.to - change.from);
      continue;
    }
    if (position === change.from) return newStart;
    return newEnd;
  }
  return position + shift;
}

function mapLocatorRows(
  locator: LaunchLocator,
  previousContent: string,
  changes: SourceTextChange[],
): LaunchLocator | null {
  const starts = lineStarts(previousContent);
  const map = (rowIndex: number) =>
    mapRow(rowIndex, starts, previousContent, changes);

  switch (locator.kind) {
    case "autoPosition": {
      const startRowIndex = map(locator.startRowIndex);
      const endRowIndex = map(locator.endRowIndex);
      return startRowIndex === null || endRowIndex === null
        ? null
        : {
            ...locator,
            startRowIndex,
            endRowIndex,
          };
    }
    case "rowColumn": {
      const startRowIndex = map(locator.startRowIndex);
      const endRowIndex = map(locator.endRowIndex);
      return startRowIndex === null || endRowIndex === null
        ? null
        : {
            ...locator,
            startRowIndex,
            endRowIndex,
          };
    }
    case "startColumn": {
      const rowIndex = map(locator.rowIndex);
      return rowIndex === null ? null : { ...locator, rowIndex };
    }
    case "wholeLine": {
      const rowIndex = map(locator.rowIndex);
      return rowIndex === null ? null : { ...locator, rowIndex };
    }
    case "multiLine": {
      const startRowIndex = map(locator.startRowIndex);
      const endRowIndex = map(locator.endRowIndex);
      return startRowIndex === null || endRowIndex === null
        ? null
        : {
            ...locator,
            startRowIndex,
            endRowIndex,
          };
    }
    case "delimited": {
      const rowIndex = map(locator.rowIndex);
      return rowIndex === null ? null : { ...locator, rowIndex };
    }
    default:
      return locator;
  }
}

function changeTouchesRange(
  change: SourceTextChange,
  start: number,
  end: number,
): boolean {
  if (change.from === change.to) {
    return change.from >= start && change.from <= end;
  }
  return change.from < end && change.to > start;
}

function deletesRange(
  change: SourceTextChange,
  start: number,
  end: number,
): boolean {
  return (
    start < end &&
    change.insert.length === 0 &&
    change.from <= start &&
    change.to >= end
  );
}

function invalidBinding(
  binding: FileLaunchBinding,
  anchor: number | undefined,
  locator = binding.locator,
): LaunchBinding {
  return {
    ...binding,
    locator,
    locatorInvalid: true,
    locatorInvalidAnchor: anchor,
  };
}

export function relocateBindingsAfterEdit(
  filePath: string,
  previousContent: string,
  nextContent: string,
  changes: SourceTextChange[],
  bindings: LaunchBinding[],
): RelocationResult {
  const invalidatedParameterKeys: string[] = [];
  const relocated = bindings.map((binding) => {
    if (!isFileBinding(binding) || binding.filePath !== filePath) {
      return binding;
    }

    if (binding.locatorInvalid) {
      const anchor = binding.locatorInvalidAnchor;
      if (anchor === undefined) return binding;
      const nextAnchor = mapPositionThroughChanges(anchor, changes);
      const canRestore =
        changes.some(
          (change) =>
            change.from <= anchor &&
            change.to >= anchor &&
            change.insert.length > 0,
        );
      const locator = mapLocatorRows(
        binding.locator,
        previousContent,
        changes,
      );
      if (!canRestore || !locator) {
        return {
          ...binding,
          locatorInvalidAnchor: nextAnchor,
        };
      }
      try {
        const resolved = resolveLaunchBinding(nextContent, locator);
        const {
          locatorInvalid: _locatorInvalid,
          locatorInvalidAnchor: _locatorInvalidAnchor,
          ...restored
        } = binding;
        void _locatorInvalid;
        void _locatorInvalidAnchor;
        return {
          ...restored,
          locator,
          defaultValue: resolved.value,
        };
      } catch {
        return {
          ...binding,
          locatorInvalidAnchor: nextAnchor,
        };
      }
    }

    let previousRange;
    try {
      previousRange = resolveLaunchBinding(
        previousContent,
        binding.locator,
      );
    } catch {
      const locator = mapLocatorRows(
        binding.locator,
        previousContent,
        changes,
      );
      if (locator) {
        try {
          resolveLaunchBinding(nextContent, locator);
          return { ...binding, locator };
        } catch {
          // The binding was not resolvable before this edit either.
        }
      }
      return binding;
    }

    const invalidAnchor = mapPositionThroughChanges(
      previousRange.start,
      changes,
    );
    const locator = mapLocatorRows(
      binding.locator,
      previousContent,
      changes,
    );
    if (!locator) {
      invalidatedParameterKeys.push(parameterKey(binding));
      return invalidBinding(binding, invalidAnchor);
    }

    let resolved;
    try {
      resolved = resolveLaunchBinding(nextContent, locator);
    } catch {
      invalidatedParameterKeys.push(parameterKey(binding));
      return invalidBinding(binding, invalidAnchor, locator);
    }

    const targetDeleted = changes.some((change) =>
      deletesRange(
        change,
        previousRange.start,
        previousRange.end,
      ),
    );
    const targetEdited = changes.some((change) =>
      changeTouchesRange(
        change,
        previousRange.start,
        previousRange.end,
      ),
    );
    if (
      targetDeleted ||
      (previousRange.end > previousRange.start &&
        resolved.end <= resolved.start)
    ) {
      invalidatedParameterKeys.push(parameterKey(binding));
      return invalidBinding(binding, invalidAnchor, locator);
    }

    return {
      ...binding,
      locator,
      defaultValue: targetEdited
        ? resolved.value
        : binding.defaultValue,
    };
  });

  return { bindings: relocated, invalidatedParameterKeys };
}
