import {
  detectSourceLineEnding,
  normalizeSourceText,
  type SourceLineEnding,
  type SourceRange,
} from "./variables.ts";
import { LauncherError } from "./locators/errors.ts";
import type {
  AutoPositionLaunchLocator,
  LaunchLocator,
  LaunchLocatorMode,
  LocatorModeValues,
  ResolvedLaunchBinding,
  RowColumnLaunchLocator,
  RowColumnParameter,
} from "./locators/model.ts";
import {
  createLocatorForStrategyMode,
  locatorStrategyForKind,
} from "./locators/registry.ts";
import { createAutoPositionLocatorFromContent } from "./locators/strategies/autoPosition.ts";

export type {
  AutoPositionLaunchLocator,
  AutoTokenRange,
  DelimitedLaunchLocator,
  JsonPathLaunchLocator,
  LaunchLocator,
  LaunchLocatorMode,
  LocatorDetail,
  LocatorEditorState,
  LocatorKind,
  LocatorModeValues,
  MarkerLaunchLocator,
  MultiLineLaunchLocator,
  PatternLaunchLocator,
  ResolvedLaunchBinding,
  RowColumnLaunchLocator,
  RowColumnParameter,
  StartColumnLaunchLocator,
  WholeLineLaunchLocator,
  XmlPathLaunchLocator,
} from "./locators/model.ts";
export { LauncherError } from "./locators/errors.ts";
export {
  tokenizeSpecialCharacters,
  type SpecialCharacterToken,
} from "./locators/shared.ts";

export type LaunchBindingDirection = "input" | "output";

export type LaunchFileRole =
  | "input"
  | "output-reference"
  | "support"
  | "program-entry"
  | "template"
  | "generated"
  | "resource";

export interface LaunchFile {
  path: string;
  roles?: LaunchFileRole[];
  name: string;
  content: string;
  lineEnding: SourceLineEnding;
  size: number;
}

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

function fileModuleName(fileName: string): string {
  return inputFileStem(fileName);
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
        : inputFileStem(binding.filePath).toLowerCase() === fileName),
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
      inputFileStem(binding.filePath).toLowerCase() === fileName,
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
          `参数“${current.name}”的引用格式无效，应为 @文件主名[In].参数名。`,
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

export interface ParameterReferenceOption {
  value: string;
  label: string;
}

export interface ParameterReferenceOptions {
  inputs: ParameterReferenceOption[];
  outputs: ParameterReferenceOption[];
}

function referenceFileLabel(binding: LaunchBinding): string {
  if (binding.module?.trim()) return binding.module.trim();
  return isFreeBinding(binding)
    ? FREE_PARAMETER_SCOPE
    : inputFileStem(binding.filePath);
}

function referenceOption(
  binding: LaunchBinding,
  direction: "input" | "output",
): ParameterReferenceOption {
  return {
    value: `@${referenceFileLabel(binding)}[${direction === "input" ? "In" : "Out"}].${binding.name}`,
    label: `${binding.name} · ${binding.parameterType}`,
  };
}

function uniqueReferenceOptions(
  bindings: LaunchBinding[],
  direction: "input" | "output",
): ParameterReferenceOption[] {
  const options = bindings.map((binding) =>
    referenceOption(binding, direction),
  );
  const counts = new Map<string, number>();
  for (const option of options) {
    counts.set(option.value, (counts.get(option.value) ?? 0) + 1);
  }
  return options
    .filter((option) => counts.get(option.value) === 1)
    .sort((left, right) =>
      left.value < right.value ? -1 : left.value > right.value ? 1 : 0,
    );
}

export function referenceOptionsForBinding(
  bindings: LaunchBinding[],
  current: LaunchBinding,
): ParameterReferenceOptions {
  const currentKey = parameterKey(current);
  const inputCandidates = bindings.filter(
    (binding) =>
      binding.direction === "input" &&
      binding.parameterType === current.parameterType &&
      parameterKey(binding) !== currentKey,
  );
  const inputs = uniqueReferenceOptions(inputCandidates, "input").filter(
    (option) => {
      const nextBindings = bindings.map((binding) =>
        parameterKey(binding) === currentKey
          ? { ...binding, inputReference: option.value }
          : binding,
      );
      return !resolveInputReferences(nextBindings).errors.has(currentKey);
    },
  );
  const outputs =
    current.direction === "output" && isFreeBinding(current)
      ? uniqueReferenceOptions(
          bindings.filter(
            (binding) =>
              binding.direction === "output" &&
              isFileBinding(binding),
          ),
          "output",
        )
      : [];
  return { inputs, outputs };
}

interface LaunchBindingBase {
  name: string;
  module?: string;
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

export function bindingsWithDefaultValues(
  bindings: LaunchBinding[],
): LaunchBinding[] {
  return bindings.map((binding) => ({
    ...binding,
    value: binding.defaultValue,
  }));
}

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



export function createLaunchFile(
  path: string,
  content: string,
): LaunchFile {
  const normalizedPath = path.trim();
  const slash = Math.max(
    normalizedPath.lastIndexOf("/"),
    normalizedPath.lastIndexOf("\\"),
  );
  const lineEnding = detectSourceLineEnding(content);
  const normalizedContent = normalizeSourceText(content);
  return {
    path: normalizedPath,
    name: normalizedPath.slice(slash + 1) || normalizedPath,
    content: normalizedContent,
    lineEnding,
    size: new Blob([content]).size,
  };
}

export function resolveLaunchBinding(
  source: string,
  locator: LaunchLocator,
): ResolvedLaunchBinding {
  return locatorStrategyForKind(locator.kind).resolve(source, locator);
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
    module: fileModuleName(file.name),
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
  return createAutoPositionLocatorFromContent(file.content, selection);
}

export function createLocatorForMode(
  mode: LaunchLocatorMode,
  values: LocatorModeValues,
  context?: {
    content?: string;
    selection?: SourceRange;
  },
): LaunchLocator {
  return createLocatorForStrategyMode(mode, values, context);
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
    module: fileModuleName(file.name),
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
    module: fileModuleName(file.name),
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
  return locatorStrategyForKind(locator.kind).formatReplacement(
    { source, resolved, nextValue },
    locator,
  );
}

function updatedLocatorAfterWrite(
  source: string,
  locator: LaunchLocator,
  replacement: string,
): LaunchLocator {
  return locatorStrategyForKind(locator.kind).afterWrite(
    { source, replacement },
    locator,
  );
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
      "启动参数只支持 @文件主名[In].参数名 语法，文件主名不含扩展名，不支持 {{参数名}}。",
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
