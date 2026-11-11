import {
  createLaunchFile,
  isFileBinding,
  isLaunchParameterType,
  parameterKey,
  resolveInputReferences,
  type FileLaunchBinding,
  type FreeLaunchBinding,
  type LaunchBinding,
  type LaunchFile,
  type LaunchLocator,
} from "./launcher.ts";
import { isLocatorKind } from "./locators/registry.ts";
import { restoreSourceLineEndings } from "./variables.ts";

export const PROJECT_SCHEMA = "program-studio-folder-project";
export const PROJECT_VERSION = 4;
export type ProjectSchemaVersion = typeof PROJECT_VERSION;
export type ProjectFileRole =
  | "input"
  | "output-reference"
  | "support"
  | "program-entry";
export type ProjectLaunchMode = "direct" | "shell";

export interface ProjectFileEntry {
  path: string;
  relativePath: string;
  roles: ProjectFileRole[];
}

export interface ProjectOutputSpec {
  name: string;
  referenceFile?: string;
  runtimePath: string;
  required: boolean;
  seed: "never" | "copy-reference";
  discovery: {
    type: "path";
  };
}

export interface ProjectOutputConfig {
  outputs: ProjectOutputSpec[];
}

export interface ProjectManifest {
  schema: typeof PROJECT_SCHEMA;
  schemaVersion: ProjectSchemaVersion;
  name: string;
  createdAt: string;
  updatedAt: string;
  launchFile: "launch.json";
  parameterFile: "parameters.json";
  outputFile?: "outputs.json";
  files: ProjectFileEntry[];
}

export interface ProjectLaunchConfig {
  mode: ProjectLaunchMode;
  program: string;
  arguments: string;
  workingDirectory: string;
  environment?: Record<string, string>;
}

export type StoredLaunchBinding =
  | Omit<FileLaunchBinding, "value">
  | Omit<FreeLaunchBinding, "value">;

export interface ProjectParameterConfig {
  bindings: StoredLaunchBinding[];
}

export interface ProjectFolderFile {
  relativePath: string;
  content: string;
}

export interface ProjectFolderPayload {
  folderPath?: string;
  folderName: string;
  manifest: ProjectManifest;
  launch: ProjectLaunchConfig;
  parameters: ProjectParameterConfig;
  outputs: ProjectOutputConfig;
  files: ProjectFolderFile[];
}

export interface ProjectSnapshot {
  name: string;
  program: string;
  arguments: string;
  workingDirectory: string;
  launchMode?: ProjectLaunchMode;
  environment?: Record<string, string>;
  files: LaunchFile[];
  bindings: LaunchBinding[];
  outputs?: ProjectOutputSpec[];
  createdAt?: string;
}

export class ProjectFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectFormatError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new ProjectFormatError(`工程字段 ${field} 必须是字符串。`);
  }
  return value;
}

function safeFileName(value: string, fallback: string): string {
  const safe = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  return safe || fallback;
}

function normalizeRelativePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "");
}

function isAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || /^[\\/]/.test(value);
}

function joinRuntimePath(root: string, relativePath: string): string {
  const separator = root.includes("\\") ? "\\" : "/";
  const relative = normalizeRelativePath(relativePath)
    .split("/")
    .filter(Boolean)
    .join(separator);
  return `${root.replace(/[\\/]+$/, "")}${separator}${relative}`;
}

function replaceFilePaths(
  value: string,
  pathReplacements: Map<string, string>,
): string {
  let result = value;
  const replacements = [...pathReplacements].sort(
    ([left], [right]) => right.length - left.length,
  );
  for (const [sourcePath, runtimePath] of replacements) {
    result = result.split(sourcePath).join(runtimePath);
    const alternate = sourcePath.replace(/\\/g, "/");
    if (alternate !== sourcePath) {
      result = result.split(alternate).join(runtimePath);
    }
  }
  return result;
}

const FILE_ROLES = new Set<ProjectFileRole>([
  "input",
  "output-reference",
  "support",
  "program-entry",
]);

const LAUNCH_MODES = new Set<ProjectLaunchMode>([
  "direct",
  "shell",
]);

function isSafeRelativePath(value: string): boolean {
  const normalized = normalizeRelativePath(value);
  return (
    Boolean(normalized) &&
    !normalized.startsWith("/") &&
    !/^[A-Za-z]:\//.test(normalized) &&
    !normalized.split("/").includes("..")
  );
}

function fileRoles(
  filePath: string,
  bindings: LaunchBinding[],
): ProjectFileRole[] {
  const roles = new Set<ProjectFileRole>();
  for (const binding of bindings) {
    if (!isFileBinding(binding)) continue;
    if (binding.filePath !== filePath) continue;
    roles.add(
      binding.direction === "input" ? "input" : "output-reference",
    );
  }
  if (roles.size === 0) roles.add("support");
  return [...roles];
}

function outputName(
  relativePath: string,
  usedNames: Set<string>,
): string {
  const baseName = relativePath.split("/").at(-1) ?? "output";
  const extensionIndex = baseName.lastIndexOf(".");
  const stem =
    extensionIndex > 0 ? baseName.slice(0, extensionIndex) : baseName;
  const safeStem = safeFileName(stem, "output");
  let candidate = safeStem;
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${safeStem}-${suffix}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function sourceDirectory(value: string): string {
  const normalized = normalizeRelativePath(value);
  const separator = normalized.lastIndexOf("/");
  return separator >= 0 ? normalized.slice(0, separator) : "";
}

function packagedWorkingDirectory(snapshot: ProjectSnapshot): string {
  const configured = snapshot.workingDirectory.trim();
  if (!configured) return "files";
  const normalized = normalizeRelativePath(configured);
  if (/(?:^|\/)files\/?$/i.test(normalized)) return "files";
  const sourceDirectories = new Set(
    snapshot.files.map((file) =>
      sourceDirectory(file.sourcePath ?? file.path).toLowerCase(),
    ),
  );
  return sourceDirectories.has(normalized.toLowerCase()) ? "files" : configured;
}

function validLocator(value: unknown): value is LaunchLocator {
  return (
    isRecord(value) &&
    typeof value.kind === "string" &&
    isLocatorKind(value.kind)
  );
}

function parseProjectOutputs(
  value: unknown,
  bindings: unknown[],
  fileEntries: ProjectFileEntry[],
): ProjectOutputSpec[] {
  const outputs: ProjectOutputSpec[] = [];
  const usedNames = new Set<string>();
  const explicit = isRecord(value) && Array.isArray(value.outputs)
    ? value.outputs
    : [];
  for (const output of explicit) {
    if (!isRecord(output)) {
      throw new ProjectFormatError("输出文件配置无效。");
    }
    const name = requiredString(output.name, "outputs.name").trim();
    if (!name || usedNames.has(name.toLowerCase())) {
      throw new ProjectFormatError("输出文件名称不能为空或重复。");
    }
    const runtimePath = normalizeRelativePath(
      requiredString(output.runtimePath, "outputs.runtimePath"),
    );
    if (!isSafeRelativePath(runtimePath)) {
      throw new ProjectFormatError(`输出运行路径越界：${runtimePath}`);
    }
    const referenceFile =
      typeof output.referenceFile === "string"
        ? normalizeRelativePath(output.referenceFile)
        : undefined;
    if (referenceFile && !isSafeRelativePath(referenceFile)) {
      throw new ProjectFormatError(`输出参考路径越界：${referenceFile}`);
    }
    const seed =
      output.seed === "copy-reference" || output.seed === "never"
        ? output.seed
        : "never";
    if (
      !isRecord(output.discovery) ||
      output.discovery.type !== "path"
    ) {
      throw new ProjectFormatError("当前只支持固定路径输出发现。");
    }
    outputs.push({
      name,
      ...(referenceFile ? { referenceFile } : {}),
      runtimePath,
      required: output.required !== false,
      seed,
      discovery: { type: "path" },
    });
    usedNames.add(name.toLowerCase());
  }

  const referenceByStoredPath = new Map<string, string>();
  for (const entry of fileEntries) {
    referenceByStoredPath.set(entry.relativePath, entry.relativePath);
    referenceByStoredPath.set(entry.path, entry.relativePath);
  }
  const coveredReferences = new Set(
    outputs.flatMap((output) =>
      output.referenceFile ? [output.referenceFile] : [],
    ),
  );
  for (const binding of bindings) {
    if (!isRecord(binding) || binding.direction !== "output") continue;
    if (typeof binding.filePath !== "string") continue;
    const referenceFile = referenceByStoredPath.get(binding.filePath);
    if (!referenceFile || coveredReferences.has(referenceFile)) continue;
    const requestedName =
      typeof binding.outputName === "string"
        ? binding.outputName.trim()
        : "";
    const name =
      requestedName && !usedNames.has(requestedName.toLowerCase())
        ? requestedName
        : outputName(referenceFile, usedNames);
    usedNames.add(name.toLowerCase());
    outputs.push({
      name,
      referenceFile,
      runtimePath: referenceFile,
      required: true,
      seed: "never",
      discovery: { type: "path" },
    });
    coveredReferences.add(referenceFile);
  }
  return outputs;
}

function parseFileRoles(
  value: unknown,
  sourcePath: string,
  relativePath: string,
  bindings: unknown[],
): ProjectFileRole[] {
  if (value !== undefined && !Array.isArray(value)) {
    throw new ProjectFormatError("工程文件角色必须是数组。");
  }
  if (Array.isArray(value)) {
    const roles = value.map((role) => {
      if (typeof role !== "string" || !FILE_ROLES.has(role as ProjectFileRole)) {
        throw new ProjectFormatError(`工程文件角色无效：${String(role)}`);
      }
      return role as ProjectFileRole;
    });
    if (roles.length > 0) return [...new Set(roles)];
  }
  const roles = new Set<ProjectFileRole>();
  for (const binding of bindings) {
    if (!isRecord(binding) || binding.filePath !== relativePath && binding.filePath !== sourcePath) {
      continue;
    }
    roles.add(
      binding.direction === "input" ? "input" : "output-reference",
    );
  }
  if (roles.size === 0) roles.add("support");
  return [...roles];
}

export function serializeProjectFolder(
  snapshot: ProjectSnapshot,
): ProjectFolderPayload {
  const now = new Date().toISOString();
  const name = snapshot.name.trim() || "未命名工程";
  const folderName = safeFileName(name, "program-project");
  const usedFileNames = new Set<string>();
  const files = snapshot.files.map((file, index) => ({
    path: file.sourcePath ?? file.path,
    roles: fileRoles(file.path, snapshot.bindings),
    relativePath: (() => {
      const baseName = safeFileName(file.name, `file-${index + 1}.txt`);
      const extensionIndex = baseName.lastIndexOf(".");
      const stem =
        extensionIndex > 0 ? baseName.slice(0, extensionIndex) : baseName;
      const extension =
        extensionIndex > 0 ? baseName.slice(extensionIndex) : "";
      let candidate = `files/${baseName}`;
      let suffix = 2;
      while (usedFileNames.has(candidate.toLowerCase())) {
        candidate = `files/${stem}-${suffix}${extension}`;
        suffix += 1;
      }
      usedFileNames.add(candidate.toLowerCase());
      return candidate;
    })(),
  }));
  const relativePathByFilePath = new Map(
    snapshot.files.map((file, index) => [
      file.path,
      files[index].relativePath,
    ]),
  );
  const usedOutputNames = new Set<string>();
  const inferredOutputReferences = new Set<string>();
  for (const binding of snapshot.bindings) {
    if (binding.direction !== "output" || !isFileBinding(binding)) continue;
    const relativePath = relativePathByFilePath.get(binding.filePath);
    if (relativePath) inferredOutputReferences.add(relativePath);
  }
  const outputs: ProjectOutputSpec[] =
    snapshot.outputs && snapshot.outputs.length > 0
      ? snapshot.outputs.map((output) => {
          const configuredReference = output.referenceFile
            ? normalizeRelativePath(output.referenceFile)
            : undefined;
          const referenceFile = configuredReference
            ? relativePathByFilePath.get(configuredReference) ??
              configuredReference
            : undefined;
          if (
            (referenceFile && !isSafeRelativePath(referenceFile)) ||
            !isSafeRelativePath(output.runtimePath)
          ) {
            throw new ProjectFormatError(
              `输出“${output.name}”包含越界路径。`,
            );
          }
          const name = output.name.trim();
          if (!name || usedOutputNames.has(name.toLowerCase())) {
            throw new ProjectFormatError("输出文件名称不能为空或重复。");
          }
          usedOutputNames.add(name.toLowerCase());
          return {
            ...output,
            name,
            ...(referenceFile ? { referenceFile } : {}),
            runtimePath: normalizeRelativePath(output.runtimePath),
          };
        })
      : [...inferredOutputReferences].map((referenceFile) => ({
          name: outputName(referenceFile, usedOutputNames),
          referenceFile,
          runtimePath: referenceFile,
          required: true,
          seed: "never" as const,
          discovery: { type: "path" as const },
        }));
  const coveredOutputReferences = new Set(
    outputs.flatMap((output) =>
      output.referenceFile ? [output.referenceFile] : [],
    ),
  );
  for (const referenceFile of inferredOutputReferences) {
    if (coveredOutputReferences.has(referenceFile)) continue;
    outputs.push({
      name: outputName(referenceFile, usedOutputNames),
      referenceFile,
      runtimePath: referenceFile,
      required: true,
      seed: "never",
      discovery: { type: "path" },
    });
    coveredOutputReferences.add(referenceFile);
  }
  const outputNameByRelativePath = new Map(
    outputs.flatMap((output) =>
      output.referenceFile
        ? [[output.referenceFile, output.name] as const]
        : [],
    ),
  );
  const bindings = snapshot.bindings.map(
    (binding): StoredLaunchBinding => {
      const common = {
        name: binding.name,
        inputReference: binding.inputReference,
        outputReference: binding.outputReference,
        parameterType: binding.parameterType,
        defaultValue: binding.defaultValue,
        unit: binding.unit,
        description: binding.description,
      };
      if (!isFileBinding(binding)) {
        return {
          ...common,
          scope: "free",
          direction: binding.direction,
        };
      }
      const relativePath = relativePathByFilePath.get(binding.filePath);
      if (!relativePath) {
        throw new ProjectFormatError(
          `参数“${binding.name}”引用了未封装文件：${binding.filePath}`,
        );
      }
      return {
        ...common,
        direction: binding.direction,
        filePath: relativePath,
        locator: binding.locator,
        locatorInvalid: binding.locatorInvalid,
        ...(binding.direction === "output"
          ? {
              outputName:
                binding.outputName ??
                outputNameByRelativePath.get(relativePath),
            }
          : {}),
      };
    },
  );
  const manifest: ProjectManifest = {
    schema: PROJECT_SCHEMA,
    schemaVersion: PROJECT_VERSION,
    name,
    createdAt: snapshot.createdAt ?? now,
    updatedAt: now,
    launchFile: "launch.json",
    parameterFile: "parameters.json",
    outputFile: "outputs.json",
    files,
  };
  const pathReplacements = new Map(
    snapshot.files.map((file, index) => [
      file.path,
      files[index].relativePath.replace(/^files\//, ""),
    ]),
  );
  return {
    folderName,
    manifest,
    launch: {
      mode: snapshot.launchMode ?? "direct",
      program: snapshot.program,
      arguments: replaceFilePaths(
        snapshot.arguments,
        pathReplacements,
      ),
      workingDirectory: packagedWorkingDirectory(snapshot),
      ...(snapshot.environment
        ? { environment: snapshot.environment }
        : {}),
    },
    parameters: { bindings },
    outputs: { outputs },
    files: snapshot.files.map((file, index) => ({
      relativePath: files[index].relativePath,
      content: restoreSourceLineEndings(file.content, file.lineEnding),
    })),
  };
}

export interface ParseProjectFolderOptions {
  mode?: "edit" | "run";
}

export function parseProjectFolder(
  payload: unknown,
  options: ParseProjectFolderOptions = {},
): {
  manifest: ProjectManifest;
  launch: ProjectLaunchConfig;
  bindings: LaunchBinding[];
  outputs: ProjectOutputSpec[];
  files: LaunchFile[];
} {
  if (!isRecord(payload) || !isRecord(payload.manifest)) {
    throw new ProjectFormatError("工程目录缺少 project.json。");
  }
  const rawManifest = payload.manifest;
  if (rawManifest.schema !== PROJECT_SCHEMA) {
    throw new ProjectFormatError("不是 Program Studio 工程目录。");
  }
  if (rawManifest.schemaVersion !== PROJECT_VERSION) {
    throw new ProjectFormatError(
      `不支持的工程版本：${String(rawManifest.schemaVersion)}`,
    );
  }
  if (
    !isRecord(payload.launch) ||
    !isRecord(payload.parameters) ||
    !isRecord(payload.outputs)
  ) {
    throw new ProjectFormatError(
      "工程目录缺少 launch.json、parameters.json 或 outputs.json。",
    );
  }
  if (
    !Array.isArray(rawManifest.files) ||
    !Array.isArray(payload.files) ||
    !Array.isArray(payload.parameters.bindings)
  ) {
    throw new ProjectFormatError("工程文件清单或参数列表无效。");
  }
  const rawBindings = payload.parameters.bindings;
  const parseMode = options.mode ?? "edit";
  const parsedFileEntries: ProjectFileEntry[] = rawManifest.files.map(
    (entry) => {
      if (!isRecord(entry)) {
        throw new ProjectFormatError("工程文件清单条目无效。");
      }
      const path = requiredString(entry.path, "manifest.files.path");
      const relativePath = requiredString(
        entry.relativePath,
        "manifest.files.relativePath",
      );
      return {
        path,
        relativePath,
        roles: parseFileRoles(
          entry.roles,
          path,
          relativePath,
          rawBindings,
        ),
      };
    },
  );
  const projectOutputs = parseProjectOutputs(
    payload.outputs,
    rawBindings,
    parsedFileEntries,
  );
  const outputByName = new Map(
    projectOutputs.map((output) => [output.name, output]),
  );
  const outputByReference = new Map(
    projectOutputs.flatMap((output) =>
      output.referenceFile
        ? [[normalizeRelativePath(output.referenceFile), output] as const]
        : [],
    ),
  );

  const fileContentByPath = new Map(
    payload.files.map((file) => {
      if (!isRecord(file)) {
        throw new ProjectFormatError("工程封装文件条目无效。");
      }
      return [
        requiredString(file.relativePath, "files.relativePath"),
        requiredString(file.content, "files.content"),
      ];
    }),
  );
  const folderPath =
    typeof payload.folderPath === "string" &&
    payload.folderPath.trim()
      ? payload.folderPath
      : null;
  const filePathByRelativePath = new Map<string, string>();
  const filePathBySourcePath = new Map<string, string>();
  const runtimePathBySourcePath = new Map<string, string>();
  const runtimePathByRelativePath = new Map<string, string>();
  const files = rawManifest.files.map((entry) => {
    if (!isRecord(entry)) {
      throw new ProjectFormatError("工程文件清单条目无效。");
    }
    const relativePath = requiredString(
      entry.relativePath,
      "manifest.files.relativePath",
    );
    const content = fileContentByPath.get(relativePath);
    if (content === undefined) {
      throw new ProjectFormatError(`工程缺少封装文件：${relativePath}`);
    }
    const sourcePath = requiredString(
      entry.path,
      "manifest.files.path",
    );
    const runtimePath = folderPath
      ? joinRuntimePath(folderPath, relativePath)
      : sourcePath;
    const file = createLaunchFile(runtimePath, content, sourcePath);
    runtimePathBySourcePath.set(sourcePath, runtimePath);
    runtimePathByRelativePath.set(
      relativePath.replace(/^files\//, ""),
      runtimePath,
    );
    filePathByRelativePath.set(relativePath, file.path);
    filePathBySourcePath.set(sourcePath, file.path);
    return file;
  });
  const filePaths = new Set(files.map((file) => file.path));
  if (filePaths.size !== files.length) {
    throw new ProjectFormatError("工程中存在重复文件路径。");
  }

  const bindings = payload.parameters.bindings.map((binding, index) => {
    if (!isRecord(binding)) {
      throw new ProjectFormatError(`第 ${index + 1} 个参数配置无效。`);
    }
    const direction = binding.direction;
    if (direction !== "input" && direction !== "output") {
      throw new ProjectFormatError(
        `第 ${index + 1} 个参数方向无效。`,
      );
    }
    const free = binding.scope === "free";
    if (
      binding.scope !== undefined &&
      binding.scope !== "file" &&
      binding.scope !== "free"
    ) {
      throw new ProjectFormatError(
        `第 ${index + 1} 个参数作用域无效。`,
      );
    }
    const storedFilePath = free
      ? ""
      : requiredString(
          binding.filePath,
          `parameters[${index}].filePath`,
        );
    const outputSpec =
      direction === "output"
        ? outputByName.get(
            typeof binding.outputName === "string"
              ? binding.outputName
              : "",
          ) ??
          outputByReference.get(normalizeRelativePath(storedFilePath))
        : undefined;
    const referenceFilePath =
      filePathByRelativePath.get(
        outputSpec?.referenceFile ?? storedFilePath,
      ) ??
      filePathBySourcePath.get(
        outputSpec?.referenceFile ?? storedFilePath,
      ) ??
      storedFilePath;
    const outputRelativePath =
      parseMode === "run"
        ? outputSpec?.runtimePath
        : outputSpec?.referenceFile;
    const filePath =
      outputRelativePath && folderPath
        ? joinRuntimePath(folderPath, outputRelativePath)
        : referenceFilePath;
    if (
      !free &&
      (direction === "input" || parseMode === "edit") &&
      !filePaths.has(filePath)
    ) {
      throw new ProjectFormatError(
        `第 ${index + 1} 个参数引用了未封装文件：${filePath}`,
      );
    }
    const locator = binding.locator;
    if (!free && !validLocator(locator)) {
      throw new ProjectFormatError(
        `第 ${index + 1} 个参数定位模式无效。`,
      );
    }
    if (!isLaunchParameterType(binding.parameterType)) {
      throw new ProjectFormatError(
        `第 ${index + 1} 个参数类型无效。`,
      );
    }
    if (
      binding.inputReference !== undefined &&
      typeof binding.inputReference !== "string"
    ) {
      throw new ProjectFormatError(
        `第 ${index + 1} 个参数引用格式无效。`,
      );
    }
    if (
      direction === "output" &&
      binding.inputReference !== undefined
    ) {
      throw new ProjectFormatError(
        `第 ${index + 1} 个输出参数不能使用输入参数引用。`,
      );
    }
    const inputReference =
      direction === "input" && typeof binding.inputReference === "string"
        ? binding.inputReference.trim()
        : undefined;
    if (inputReference && !/^@.+\[In\]\..+$/i.test(inputReference)) {
      throw new ProjectFormatError(
        `第 ${index + 1} 个输入参数引用格式应为 @文件主名[In].参数名，文件主名不含扩展名。`,
      );
    }
    if (
      binding.outputReference !== undefined &&
      typeof binding.outputReference !== "string"
    ) {
      throw new ProjectFormatError(
        `第 ${index + 1} 个输出参数引用格式无效。`,
      );
    }
    const outputReference =
      free &&
      direction === "output" &&
      typeof binding.outputReference === "string"
        ? binding.outputReference.trim()
        : undefined;
    if (
      outputReference &&
      !/^@.+\[Out\]\..+$/i.test(outputReference)
    ) {
      throw new ProjectFormatError(
        `第 ${index + 1} 个输出参数引用格式应为 @文件主名[Out].参数名，文件主名不含扩展名。`,
      );
    }
    if (
      binding.outputReference !== undefined &&
      !outputReference
    ) {
      throw new ProjectFormatError(
        "只有不绑定文件的输出参数可以引用其他输出。",
      );
    }
    const defaultValue = requiredString(
      binding.defaultValue,
      `parameters[${index}].defaultValue`,
    );
    const common = {
      name: requiredString(binding.name, `parameters[${index}].name`),
      value: defaultValue,
      parameterType: binding.parameterType,
      ...(inputReference ? { inputReference } : {}),
      ...(outputReference ? { outputReference } : {}),
      defaultValue,
      unit: requiredString(
        binding.unit,
        `parameters[${index}].unit`,
      ),
      description: requiredString(
        binding.description,
        `parameters[${index}].description`,
      ),
    };
    return free
      ? ({
          ...common,
          scope: "free",
          direction,
        } satisfies LaunchBinding)
      : ({
          ...common,
          direction,
          filePath,
          ...(outputSpec ? { outputName: outputSpec.name } : {}),
          locator: locator as LaunchLocator,
          locatorInvalid:
            binding.locatorInvalid === true ? true : undefined,
        } satisfies LaunchBinding);
  });
  const parameterKeys = new Set<string>();
  for (const binding of bindings) {
    const key = parameterKey(binding);
    if (parameterKeys.has(key)) {
      throw new ProjectFormatError(`参数主键重复：${key}`);
    }
    parameterKeys.add(key);
  }
  const referenceResolution = resolveInputReferences(bindings);
  const referenceError = [...referenceResolution.errors.values()][0];
  if (referenceError) {
    throw new ProjectFormatError(referenceError);
  }

  const storedMode = payload.launch.mode;
  const launchMode =
    typeof storedMode === "string" &&
    LAUNCH_MODES.has(storedMode as ProjectLaunchMode)
      ? (storedMode as ProjectLaunchMode)
      : "direct";
  const environment =
    payload.launch.environment === undefined
      ? undefined
      : isRecord(payload.launch.environment)
        ? Object.fromEntries(
            Object.entries(payload.launch.environment).map(([key, value]) => [
              key,
              requiredString(
                value,
                `launch.environment.${key}`,
              ),
            ]),
          )
        : (() => {
            throw new ProjectFormatError(
              "launch.environment 必须是对象。",
            );
          })();
  const launch: ProjectLaunchConfig = {
    mode: launchMode,
    program: requiredString(payload.launch.program, "launch.program"),
    arguments: replaceFilePaths(
      requiredString(
        payload.launch.arguments,
        "launch.arguments",
      ),
      new Map([
        ...runtimePathBySourcePath,
        ...runtimePathByRelativePath,
      ]),
    ),
    workingDirectory: (() => {
      const stored = requiredString(
        payload.launch.workingDirectory,
        "launch.workingDirectory",
      );
      return folderPath && !isAbsolutePath(stored)
        ? joinRuntimePath(folderPath, stored)
        : stored;
    })(),
    ...(environment ? { environment } : {}),
  };
  const manifest: ProjectManifest = {
    schema: PROJECT_SCHEMA,
    schemaVersion: PROJECT_VERSION,
    name: requiredString(rawManifest.name, "manifest.name"),
    createdAt: requiredString(rawManifest.createdAt, "manifest.createdAt"),
    updatedAt: requiredString(rawManifest.updatedAt, "manifest.updatedAt"),
    launchFile: "launch.json",
    parameterFile: "parameters.json",
    outputFile: "outputs.json",
    files: rawManifest.files.map((entry) => {
      const record = entry as Record<string, unknown>;
      const path = requiredString(record.path, "manifest.files.path");
      const relativePath = requiredString(
        record.relativePath,
        "manifest.files.relativePath",
      );
      return {
        path,
        relativePath,
        roles: parseFileRoles(
          record.roles,
          path,
          relativePath,
          rawBindings,
        ),
      };
    }),
  };
  return {
    manifest,
    launch,
    bindings,
    outputs: projectOutputs,
    files,
  };
}
