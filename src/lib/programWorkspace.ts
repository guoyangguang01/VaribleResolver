import {
  FREE_PARAMETER_SCOPE,
  isFileBinding,
  isFreeBinding,
  parameterFileName,
  type LaunchBinding,
  type LaunchBindingDirection,
} from "./launcher.ts";
import { locatorSummary } from "./locatorPresentation.ts";
import type { ProjectSnapshot } from "./projectFolder.ts";
import type { SourceRange } from "./variables.ts";

export {
  locatorDetails,
  locatorEditorState,
} from "./locatorPresentation.ts";

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
      `@${fileStem(oldFilePath)}[In].${oldName}`,
      `@${fileStem(newFilePath)}[In].${newName}`,
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
  if (fileName === fileStem(oldFilePath)) {
    return `@${fileStem(newFilePath)}[${direction}].${parameterName}`;
  }
  return reference;
}

export function locatorLabel(binding: LaunchBinding): string {
  if (isFreeBinding(binding)) return "自由参数";
  if (binding.locatorInvalid) return "定位失效";
  return locatorSummary(binding.locator);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败。";
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
