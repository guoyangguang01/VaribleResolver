import {
  FREE_PARAMETER_SCOPE,
  isFileBinding,
  isFreeBinding,
  parameterFileName,
  type AutoTokenRange,
  type LaunchBinding,
  type LaunchBindingDirection,
  type LaunchLocator,
  type LaunchLocatorMode,
  type LocatorModeValues,
} from "./launcher.ts";
import type { ProjectSnapshot } from "./projectFolder.ts";
import type { SourceRange } from "./variables.ts";

export function projectRevision(snapshot: ProjectSnapshot): string {
  return JSON.stringify({
    name: snapshot.name,
    program: snapshot.program,
    arguments: snapshot.arguments,
    workingDirectory: snapshot.workingDirectory,
    launchMode: snapshot.launchMode,
    outputs: snapshot.outputs,
    files: snapshot.files.map((file) => ({
      path: file.path,
      content: file.content,
    })),
    bindings: snapshot.bindings,
  });
}

export function bindingName(
  requestedName: string,
  direction: LaunchBindingDirection,
  filePath: string,
  bindings: LaunchBinding[],
): string {
  const base =
    requestedName.trim() ||
    `${direction === "input" ? "输入" : "输出"}参数`;
  const names = new Set(
    bindings
      .filter((binding) =>
        filePath === FREE_PARAMETER_SCOPE
          ? isFreeBinding(binding)
          : isFileBinding(binding) && binding.filePath === filePath,
      )
      .map((binding) => binding.name),
  );
  if (!names.has(base)) return base;
  let suffix = 2;
  while (names.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

function fileStem(filePath: string): string {
  const fileName = parameterFileName(filePath);
  const separator = fileName.lastIndexOf(".");
  return separator > 0 ? fileName.slice(0, separator) : fileName;
}

export function remapParameterReference(
  reference: string | undefined,
  oldFilePath: string,
  newFilePath: string,
  oldName: string,
  newName: string,
): string | undefined {
  if (!reference) return reference;
  const normalized = reference.trim();
  const transitions = [
    [
      `@${parameterFileName(oldFilePath)}[In].${oldName}`,
      `@${parameterFileName(newFilePath)}[In].${newName}`,
    ],
    [
      `@${fileStem(oldFilePath)}[In].${oldName}`,
      `@${fileStem(newFilePath)}[In].${newName}`,
    ],
    [
      `@${parameterFileName(oldFilePath)}[Out].${oldName}`,
      `@${parameterFileName(newFilePath)}[Out].${newName}`,
    ],
    [
      `@${fileStem(oldFilePath)}[Out].${oldName}`,
      `@${fileStem(newFilePath)}[Out].${newName}`,
    ],
  ] as const;
  for (const [previous, next] of transitions) {
    if (normalized === previous) return next;
  }
  return reference;
}

export function remapReferenceFile(
  reference: string | undefined,
  oldFilePath: string,
  newFilePath: string,
): string | undefined {
  if (!reference) return reference;
  const normalized = reference.trim();
  if (!normalized.startsWith("@")) return reference;
  const expression = normalized.slice(1);
  const match = /^(.+)\[(in|out)\]\.(.+)$/i.exec(expression);
  if (!match) return reference;
  const fileName = match[1];
  const direction = match[2];
  const parameterName = match[3];
  if (fileName === parameterFileName(oldFilePath)) {
    return `@${parameterFileName(newFilePath)}[${direction}].${parameterName}`;
  }
  if (fileName === fileStem(oldFilePath)) {
    return `@${fileStem(newFilePath)}[${direction}].${parameterName}`;
  }
  return reference;
}

export function locatorLabel(binding: LaunchBinding): string {
  if (isFreeBinding(binding)) return "自由参数";
  if (binding.locatorInvalid) return "定位失效";
  switch (binding.locator.kind) {
    case "autoPosition":
      return `自动 · R${binding.locator.startRowIndex}:C${binding.locator.startColumnIndex}`;
    case "rowColumn":
      return `固定长度 · R${binding.locator.startRowIndex}:C${binding.locator.startColumnIndex}`;
    case "startColumn":
      return `起始列 · R${binding.locator.rowIndex}:C${binding.locator.startColumnIndex}`;
    case "wholeLine":
      return `整行 · R${binding.locator.rowIndex}`;
    case "multiLine":
      return `多行 · R${binding.locator.startRowIndex}-R${binding.locator.endRowIndex}`;
    case "delimited":
      return `分段 · 第 ${binding.locator.fieldIndex} 段`;
    case "marker":
      return "不定行 · 标记范围";
    case "jsonPath":
      return `JSON · ${binding.locator.path}`;
    case "xmlPath":
      return `XML · ${binding.locator.path}`;
    case "pattern":
      return `模式 · /${binding.locator.pattern}/`;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败。";
}

export function locatorEditorState(locator: LaunchLocator): {
  mode: LaunchLocatorMode;
  values: LocatorModeValues;
} {
  switch (locator.kind) {
    case "autoPosition":
      return {
        mode: "auto",
        values: {
          startRowIndex: locator.startRowIndex,
          startColumnIndex: locator.startColumnIndex,
          endRowIndex: locator.endRowIndex,
          endColumnIndex: locator.endColumnIndex,
        },
      };
    case "rowColumn":
      return {
        mode: "fixedLength",
        values: {
          startRowIndex: locator.startRowIndex,
          startColumnIndex: locator.startColumnIndex,
          endRowIndex: locator.endRowIndex,
          endColumnIndex: locator.endColumnIndex,
        },
      };
    case "startColumn":
      return {
        mode: "startColumn",
        values: {
          startRowIndex: locator.rowIndex,
          startColumnIndex: locator.startColumnIndex,
        },
      };
    case "wholeLine":
      return {
        mode: "wholeLine",
        values: { startRowIndex: locator.rowIndex },
      };
    case "multiLine":
      return {
        mode: "multiLine",
        values: {
          startRowIndex: locator.startRowIndex,
          endRowIndex: locator.endRowIndex,
        },
      };
    case "delimited":
      return {
        mode: "delimited",
        values: {
          startRowIndex: locator.rowIndex,
          separator: locator.separator,
          fieldIndex: locator.fieldIndex,
        },
      };
    case "marker":
      return {
        mode: "indefiniteLine",
        values: {
          startMarker: locator.startMarker,
          endMarker: locator.endMarker,
          occurrence: locator.occurrence,
        },
      };
    case "jsonPath":
      return {
        mode: "jsonPath",
        values: { jsonPath: locator.path },
      };
    case "xmlPath":
      return {
        mode: "xmlPath",
        values: { xmlPath: locator.path },
      };
    case "pattern":
      return {
        mode: "pattern",
        values: {
          pattern: locator.pattern,
          flags: locator.flags,
          captureGroup: locator.captureGroup,
          occurrence: locator.occurrence,
        },
      };
  }
}

export function locatorDetails(
  locator: LaunchLocator,
): Array<{ label: string; value: string }> {
  switch (locator.kind) {
    case "autoPosition": {
      const details = [
        { label: "起始行", value: String(locator.startRowIndex) },
        { label: "起始列", value: String(locator.startColumnIndex) },
        { label: "结束行", value: String(locator.endRowIndex) },
        { label: "结束列", value: String(locator.endColumnIndex) },
      ];
      if (locator.tokenRange) {
        details.push(...tokenRangeDetails(locator.tokenRange));
      }
      return details;
    }
    case "rowColumn":
      return [
        { label: "起始行", value: String(locator.startRowIndex) },
        { label: "起始列", value: String(locator.startColumnIndex) },
        { label: "结束行", value: String(locator.endRowIndex) },
        { label: "结束列", value: String(locator.endColumnIndex) },
      ];
    case "startColumn":
      return [
        { label: "行", value: String(locator.rowIndex) },
        { label: "起始列", value: String(locator.startColumnIndex) },
      ];
    case "wholeLine":
      return [{ label: "行", value: String(locator.rowIndex) }];
    case "multiLine":
      return [
        { label: "起始行", value: String(locator.startRowIndex) },
        { label: "结束行", value: String(locator.endRowIndex) },
      ];
    case "delimited":
      return [
        { label: "行", value: String(locator.rowIndex) },
        { label: "分隔符", value: locator.separator },
        { label: "分段序号", value: String(locator.fieldIndex) },
      ];
    case "marker":
      return [
        { label: "起始标记", value: locator.startMarker },
        { label: "结束标记", value: locator.endMarker },
        { label: "匹配序号", value: String(locator.occurrence) },
      ];
    case "jsonPath":
      return [{ label: "JSON 路径", value: locator.path }];
    case "xmlPath":
      return [{ label: "XML 路径", value: locator.path }];
    case "pattern":
      return [
        { label: "正则表达式", value: locator.pattern },
        { label: "标志", value: locator.flags || "无" },
        { label: "捕获组", value: String(locator.captureGroup) },
        { label: "匹配序号", value: String(locator.occurrence) },
      ];
  }
}

export function tokenRangeDetails(
  tokenRange: AutoTokenRange,
): Array<{ label: string; value: string }> {
  return [
    { label: "Token 定位", value: "特殊字符相对边界" },
    { label: "Token 数量", value: String(tokenRange.tokenCount) },
    {
      label: "起始 Token",
      value: `第 ${tokenRange.startTokenIndex + 1} 个 +${tokenRange.startOffsetFromTokenStart}`,
    },
    {
      label: "结束 Token",
      value: `第 ${tokenRange.endTokenIndex + 1} 个 -${tokenRange.endOffsetFromTokenEnd}`,
    },
  ];
}

export function selectionScore(
  selection: SourceRange,
  resolved: SourceRange,
): number {
  if (selection.start === selection.end) {
    return selection.start >= resolved.start &&
      selection.start <= resolved.end
      ? 1
      : 0;
  }
  const overlapStart = Math.max(selection.start, resolved.start);
  const overlapEnd = Math.min(selection.end, resolved.end);
  if (overlapEnd <= overlapStart) return 0;
  const selectionLength = selection.end - selection.start;
  const resolvedLength = resolved.end - resolved.start;
  const overlap = overlapEnd - overlapStart;
  let score = overlap / Math.max(1, Math.max(selectionLength, resolvedLength));
  if (
    selection.start === resolved.start &&
    selection.end === resolved.end
  ) {
    score += 2;
  }
  return score;
}
