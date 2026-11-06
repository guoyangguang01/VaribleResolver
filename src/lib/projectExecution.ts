import {
  LauncherError,
  createLaunchFile,
  extractOutputBindings,
  interpolateArguments,
  parseCommandArguments,
  resolveLaunchBinding,
  validateParameterValue,
  writeInputBindings,
  type LaunchBinding,
  type LaunchFile,
  type OutputExtraction,
} from "./launcher.ts";
import { normalizeSourceText } from "./variables.ts";

export interface ProjectExecutionSnapshot {
  program: string;
  arguments: string;
  workingDirectory: string;
  files: LaunchFile[];
  bindings: LaunchBinding[];
}

export interface ProjectProgramRequest {
  program: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
}

export interface ProjectProgramResult {
  status: "completed" | "failed" | "timeout";
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

export type ProjectInputOverride =
  | {
      target: "bindingId";
      bindingId: string;
      value: string;
    }
  | {
      target: "name";
      name: string;
      value: string;
    };

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
  timeoutMs?: number;
}

export interface EffectiveInputValue {
  bindingId: string;
  name: string;
  filePath: string;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}

function uniqueBindingPaths(bindings: LaunchBinding[]): string[] {
  return [...new Set(bindings.map((binding) => binding.filePath))];
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
  const inputsById = new Map(
    inputs.map((binding) => [binding.id, binding]),
  );
  const inputsByName = new Map<string, LaunchBinding[]>();
  for (const binding of inputs) {
    const matches = inputsByName.get(binding.name) ?? [];
    matches.push(binding);
    inputsByName.set(binding.name, matches);
  }
  const requestedValues = new Map<string, string>();
  const errors: string[] = [];
  for (const override of overrides) {
    let binding: LaunchBinding | undefined;
    let selector: string;
    if (override.target === "bindingId") {
      const bindingId = override.bindingId.trim();
      selector = `绑定 ID“${bindingId}”`;
      if (!bindingId) {
        errors.push("绑定 ID 不能为空。");
        continue;
      }
      binding = inputsById.get(bindingId);
    } else {
      const name = override.name.trim();
      selector = `参数名“${name}”`;
      if (!name) {
        errors.push("参数名不能为空。");
        continue;
      }
      const matches = inputsByName.get(name) ?? [];
      if (matches.length > 1) {
        errors.push(`${selector}对应多个输入绑定，请改用绑定 ID。`);
        continue;
      }
      binding = matches[0];
    }
    if (!binding) {
      const otherDirection = snapshot.bindings.find((candidate) =>
        override.target === "bindingId"
          ? candidate.id === override.bindingId.trim()
          : candidate.name === override.name.trim(),
      );
      errors.push(
        otherDirection
          ? `${selector}是${otherDirection.direction === "output" ? "输出" : "非输入"}参数，不能覆盖。`
          : `未找到可覆盖的输入参数${selector}。`,
      );
      continue;
    }
    if (requestedValues.has(binding.id)) {
      errors.push(`${selector}对应的输入参数被重复覆盖。`);
      continue;
    }

    const value = String(override.value);
    const valueError = validateParameterValue(binding.parameterType, value);
    if (valueError) {
      errors.push(`参数“${binding.name}”${valueError}`);
      continue;
    }
    requestedValues.set(binding.id, value);
  }

  if (errors.length > 0) {
    throw new ProjectExecutionError(errors.join("；"));
  }

  const effectiveBindings = snapshot.bindings.map((binding) => {
    const requestedValue = requestedValues.get(binding.id);
    return requestedValue === undefined
      ? binding
      : { ...binding, value: requestedValue };
  });

  return {
    bindings: effectiveBindings,
    targets: inputs.filter((binding) =>
      requestedValues.has(binding.id),
    ),
    requestedValues,
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
    const requestedValue = requestedValues.get(binding.id) ?? "";
    const file = filesByPath.get(binding.filePath);
    let originalValue: string | null = null;
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
    return {
      bindingId: binding.id,
      name: binding.name,
      filePath: binding.filePath,
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
  targetBindingIds: Set<string>,
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
      targetBindingIds.has(binding.id) &&
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
        targetBindingIds.has(binding.id),
    );
    if (localBindings.length === 0) continue;
    const result = writeInputBindings(file.content, localBindings);
    if (result.errors.length > 0) {
      for (const error of result.errors) {
        const binding = bindings.find(
          (candidate) => candidate.id === error.bindingId,
        );
        errors.push(
          `${file.name} / ${binding?.name ?? "参数"}：${error.message}`,
        );
      }
      continue;
    }
    if (result.source !== file.content) {
      writes.push({ path: file.path, content: result.source });
    }
    const updatedById = new Map(
      result.bindings.map((binding) => [binding.id, binding]),
    );
    updatedBindings = updatedBindings.map(
      (binding) => updatedById.get(binding.id) ?? binding,
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
            normalizeSourceText(file.content),
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
    timeoutMs = 10 * 60 * 1000,
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
          normalizeSourceText(diskFile.content),
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
      new Set(resolvedOverrides.targets.map((binding) => binding.id)),
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
      program: snapshot.program.trim(),
      args,
      cwd: snapshot.workingDirectory.trim() || undefined,
      timeoutMs,
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
    const readError = after.readErrors.get(output.filePath);
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
