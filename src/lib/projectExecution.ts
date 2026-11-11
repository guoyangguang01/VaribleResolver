import {
  FREE_PARAMETER_SCOPE,
  LauncherError,
  createLaunchFile,
  extractOutputBindings,
  interpolateArguments,
  isFileBinding,
  parseCommandArguments,
  parameterFileName,
  parameterKey,
  resolveInputReferences,
  resolveLaunchBinding,
  validateParameterValue,
  writeInputBindings,
  type LaunchBinding,
  type LaunchFile,
  type OutputExtraction,
} from "./launcher.ts";
import { restoreSourceLineEndings } from "./variables.ts";

export interface ProjectExecutionSnapshot {
  program: string;
  arguments: string;
  workingDirectory: string;
  launchMode?: "direct" | "shell";
  environment?: Record<string, string>;
  files: LaunchFile[];
  bindings: LaunchBinding[];
}

export interface ProjectProgramRequest {
  mode: "direct" | "shell";
  program: string;
  args: string[];
  cwd?: string;
  environment?: Record<string, string>;
}

export interface ProjectProgramResult {
  status: "completed" | "failed";
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface ProjectExecutionReadFile {
  path: string;
  content: string;
}

export interface ProjectInputOverride {
  fileName: string;
  parameterName: string;
  value: string;
}

export interface ProjectExecutionAdapter {
  readFile(
    filePath: string,
  ): Promise<ProjectExecutionReadFile | null>;
  writeFiles(
    files: Array<{ path: string; content: string }>,
  ): Promise<unknown>;
  runProgram(request: ProjectProgramRequest): Promise<ProjectProgramResult>;
}

export interface ProjectExecutionRequest {
  snapshot: ProjectExecutionSnapshot;
  overrides?: ProjectInputOverride[];
  adapter: ProjectExecutionAdapter;
}

export interface EffectiveInputValue {
  parameterKey: string;
  name: string;
  filePath?: string;
  originalValue: string | null;
  requestedValue: string | null;
  effectiveValue: string;
  changed: boolean;
}

export interface ProjectExecutionResult {
  runtime: ProjectProgramResult;
  inputs: EffectiveInputValue[];
  outputs: OutputExtraction[];
}

export class ProjectExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectExecutionError";
  }
}

function overrideKey(override: ProjectInputOverride): string {
  const fileName = parameterFileName(override.fileName)
    .replace(/\.[^.]+$/, "")
    .toLowerCase();
  return `${fileName}.${override.parameterName.trim()}`;
}

export function mergeInputOverrides(
  defaultOverrides: ProjectInputOverride[],
  runtimeOverrides: ProjectInputOverride[],
): ProjectInputOverride[] {
  const merged = new Map<string, ProjectInputOverride>();
  for (const override of defaultOverrides) {
    merged.set(overrideKey(override), override);
  }
  for (const override of runtimeOverrides) {
    merged.set(overrideKey(override), override);
  }
  return [...merged.values()];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}

function uniqueBindingPaths(bindings: LaunchBinding[]): string[] {
  return [
    ...new Set(
      bindings.flatMap((binding) =>
        isFileBinding(binding) ? [binding.filePath] : [],
      ),
    ),
  ];
}

function snapshotFile(
  snapshot: ProjectExecutionSnapshot,
  filePath: string,
): LaunchFile | undefined {
  return snapshot.files.find((file) => file.path === filePath);
}

function resolveInputOverrides(
  snapshot: ProjectExecutionSnapshot,
  overrides: ProjectInputOverride[],
): {
  bindings: LaunchBinding[];
  targets: LaunchBinding[];
  requestedValues: Map<string, string>;
} {
  const inputs = snapshot.bindings.filter(
    (binding) => binding.direction === "input",
  );
  const referenceResolution = resolveInputReferences(snapshot.bindings);
  const referenceError = [...referenceResolution.errors.values()][0];
  if (referenceError) {
    throw new ProjectExecutionError(referenceError);
  }
  const inputFileMatches = (
    binding: LaunchBinding,
    fileName: string,
  ): boolean => {
    if (!isFileBinding(binding)) {
      return fileName.toLowerCase() === FREE_PARAMETER_SCOPE.toLowerCase();
    }
    const actualFileName = parameterFileName(binding.filePath);
    const stem = actualFileName.replace(/\.[^.]+$/, "");
    const requested = fileName.toLowerCase();
    return (
      actualFileName.toLowerCase() === requested ||
      stem.toLowerCase() === requested
    );
  };
  const requestedValues = new Map<string, string>();
  const errors: string[] = [];
  for (const override of overrides) {
    const fileName = override.fileName.trim();
    const parameterName = override.parameterName.trim();
    const selector = `参数“${fileName}.${parameterName}”`;
    if (!fileName || !parameterName) {
      errors.push("文件名和参数名不能为空。");
      continue;
    }
    const matches = inputs.filter(
      (binding) =>
        binding.name === parameterName &&
        inputFileMatches(binding, fileName),
    );
    if (matches.length > 1) {
      errors.push(
        `${selector}对应多个输入绑定，请确认文件名和参数名唯一。`,
      );
      continue;
    }
    const binding = matches[0];
    if (!binding) {
      const otherDirection = snapshot.bindings.find(
        (candidate) =>
          candidate.direction !== "input" &&
          candidate.name === parameterName &&
          inputFileMatches(candidate, fileName),
      );
      errors.push(
        otherDirection
          ? `${selector}是输出参数，不能覆盖。`
          : `未找到可覆盖的输入参数${selector}。`,
      );
      continue;
    }
    const bindingKey = parameterKey(binding);
    const root = referenceResolution.roots.get(bindingKey);
    if (!root) {
      errors.push(`${selector}无法解析所引用的输入参数。`);
      continue;
    }
    const rootKey = parameterKey(root);
    if (rootKey !== bindingKey) {
      errors.push(
        `${selector}是引用参数，请改为覆盖主参数“${root.name}”。`,
      );
      continue;
    }
    if (requestedValues.has(rootKey)) {
      errors.push(`${selector}对应的输入参数被重复覆盖。`);
      continue;
    }

    const value = String(override.value);
    const valueError = validateParameterValue(
      binding.parameterType,
      value,
    );
    if (valueError) {
      errors.push(`参数“${binding.name}”${valueError}`);
      continue;
    }
    requestedValues.set(rootKey, value);
  }

  if (errors.length > 0) {
    throw new ProjectExecutionError(errors.join("；"));
  }

  const effectiveBindings = snapshot.bindings.map((binding) => {
    if (binding.direction === "output") return binding;
    const root = referenceResolution.roots.get(parameterKey(binding));
    if (!root) return binding;
    const rootKey = parameterKey(root);
    const requestedValue = requestedValues.get(rootKey);
    if (requestedValue !== undefined) {
      return { ...binding, value: requestedValue };
    }
    return rootKey === parameterKey(binding)
      ? binding
      : { ...binding, value: root.value };
  });
  const effectiveRequestedValues = new Map(
    effectiveBindings.flatMap((binding) => {
      if (binding.direction !== "input") return [];
      const root = referenceResolution.roots.get(parameterKey(binding));
      return root && requestedValues.has(parameterKey(root))
        ? [[parameterKey(binding), binding.value] as const]
        : [];
    }),
  );

  return {
    bindings: effectiveBindings,
    targets: effectiveBindings.filter((binding) =>
      effectiveRequestedValues.has(parameterKey(binding)),
    ),
    requestedValues: effectiveRequestedValues,
  };
}

function describeEffectiveInputs(
  targets: LaunchBinding[],
  requestedValues: Map<string, string>,
  sourceFiles: LaunchFile[],
): EffectiveInputValue[] {
  const filesByPath = new Map(
    sourceFiles.map((file) => [file.path, file]),
  );
  return targets.map((binding) => {
    const requestedValue =
      requestedValues.get(parameterKey(binding)) ?? "";
    const file = isFileBinding(binding)
      ? filesByPath.get(binding.filePath)
      : null;
    let originalValue: string | null = null;
    if (isFileBinding(binding)) {
      try {
        if (!file) {
          throw new LauncherError(
            `输入文件不存在：${binding.filePath}`,
          );
        }
        originalValue = resolveLaunchBinding(
          file.content,
          binding.locator,
        ).value;
      } catch {
        originalValue = null;
      }
    }
    return {
      parameterKey: parameterKey(binding),
      name: binding.name,
      ...(isFileBinding(binding)
        ? { filePath: binding.filePath }
        : {}),
      originalValue,
      requestedValue,
      effectiveValue: requestedValue,
      changed:
        originalValue === null || originalValue !== requestedValue,
    };
  });
}

function prepareInputWrites(
  sourceFiles: LaunchFile[],
  bindings: LaunchBinding[],
  targetParameterKeys: Set<string>,
): {
  writes: Array<{ path: string; content: string }>;
  bindings: LaunchBinding[];
} {
  const sourceByPath = new Map(
    sourceFiles.map((file) => [file.path, file]),
  );
  const errors: string[] = [];
  for (const binding of bindings) {
    if (
      binding.direction === "input" &&
      isFileBinding(binding) &&
      targetParameterKeys.has(parameterKey(binding)) &&
      !sourceByPath.has(binding.filePath)
    ) {
      errors.push(`参数“${binding.name}”引用的文件不存在。`);
    }
  }

  let updatedBindings = bindings;
  const writes: Array<{ path: string; content: string }> = [];
  for (const file of sourceFiles) {
    const localBindings = updatedBindings.filter(
      (binding) =>
        binding.filePath === file.path &&
        binding.direction === "input" &&
        isFileBinding(binding) &&
        targetParameterKeys.has(parameterKey(binding)),
    );
    if (localBindings.length === 0) continue;
    const result = writeInputBindings(file.content, localBindings);
    if (result.errors.length > 0) {
      for (const error of result.errors) {
        const binding = bindings.find(
          (candidate) =>
            parameterKey(candidate) === error.parameterKey,
        );
        errors.push(
          `${file.name} / ${binding?.name ?? "参数"}：${error.message}`,
        );
      }
      continue;
    }
    if (result.source !== file.content) {
      writes.push({
        path: file.path,
        content: restoreSourceLineEndings(result.source, file.lineEnding),
      });
    }
    const updatedById = new Map(
      result.bindings.map((binding) => [parameterKey(binding), binding]),
    );
    updatedBindings = updatedBindings.map(
      (binding) => updatedById.get(parameterKey(binding)) ?? binding,
    );
  }

  if (errors.length > 0) {
    throw new ProjectExecutionError(
      `输入写回校验失败：${errors.join("；")}`,
    );
  }
  return { writes, bindings: updatedBindings };
}

async function readAfterFiles(
  outputBindings: LaunchBinding[],
  adapter: ProjectExecutionAdapter,
): Promise<{
  files: LaunchFile[];
  readErrors: Map<string, string>;
}> {
  const files: LaunchFile[] = [];
  const readErrors = new Map<string, string>();
  for (const filePath of uniqueBindingPaths(outputBindings)) {
    try {
      const file = await adapter.readFile(filePath);
      if (file) {
        files.push(
          createLaunchFile(
            file.path,
            file.content,
          ),
        );
      }
    } catch (error) {
      readErrors.set(filePath, errorMessage(error));
    }
  }
  return { files, readErrors };
}

export async function executeProjectWithOverrides(
  request: ProjectExecutionRequest,
): Promise<ProjectExecutionResult> {
  const {
    snapshot,
    adapter,
    overrides = [],
  } = request;
  if (!snapshot.program.trim()) {
    throw new ProjectExecutionError("程序路径不能为空。");
  }

  const resolvedOverrides = resolveInputOverrides(
    snapshot,
    overrides,
  );
  const targetPaths = uniqueBindingPaths(
    resolvedOverrides.targets,
  );

  const sourceFiles: LaunchFile[] = [];
  for (const filePath of targetPaths) {
    let diskFile: ProjectExecutionReadFile | null;
    try {
      diskFile = await adapter.readFile(filePath);
    } catch (error) {
      throw new ProjectExecutionError(
        `读取覆盖目标文件失败：${filePath}：${errorMessage(error)}`,
      );
    }
    if (diskFile) {
      sourceFiles.push(
        createLaunchFile(
          diskFile.path,
          diskFile.content,
        ),
      );
      continue;
    }
    const storedFile = snapshotFile(snapshot, filePath);
    if (storedFile) sourceFiles.push(storedFile);
  }

  const effectiveInputs = describeEffectiveInputs(
    resolvedOverrides.targets,
    resolvedOverrides.requestedValues,
    sourceFiles,
  );
  let prepared;
  let args: string[];
  try {
    prepared = prepareInputWrites(
      sourceFiles,
      resolvedOverrides.bindings,
      new Set(resolvedOverrides.targets.map(parameterKey)),
    );
    args = interpolateArguments(
      parseCommandArguments(snapshot.arguments),
      prepared.bindings,
    );
  } catch (error) {
    throw error instanceof ProjectExecutionError
      ? error
      : new ProjectExecutionError(errorMessage(error));
  }

  let runtime: ProjectProgramResult = {
    status: "failed",
    exitCode: null,
    signal: null,
    error: "程序尚未启动。",
    stdout: "",
    stderr: "",
    durationMs: 0,
  };
  let outputs: OutputExtraction[] = [];
  if (prepared.writes.length > 0) {
    await adapter.writeFiles(prepared.writes);
  }
  const startedAt = Date.now();
  try {
    runtime = await adapter.runProgram({
      mode: snapshot.launchMode ?? "direct",
      program: snapshot.program.trim(),
      args,
      cwd: snapshot.workingDirectory.trim() || undefined,
      environment: snapshot.environment,
    });
  } catch (error) {
    runtime = {
      status: "failed",
      exitCode: null,
      signal: null,
      error: errorMessage(error),
      stdout: "",
      stderr: "",
      durationMs: Date.now() - startedAt,
    };
  }

  const after = await readAfterFiles(
    snapshot.bindings.filter(
      (binding) => binding.direction === "output",
    ),
    adapter,
  );
  outputs = extractOutputBindings(
    after.files,
    snapshot.bindings,
  ).map((output) => {
    const readError = output.filePath
      ? after.readErrors.get(output.filePath)
      : undefined;
    return readError
      ? { ...output, value: null, range: null, error: readError }
      : output;
  });

  return {
    runtime,
    inputs: effectiveInputs,
    outputs,
  };
}
