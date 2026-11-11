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
  type LaunchFileRole,
  type LaunchLocator,
} from "./launcher.ts";
import { isLocatorKind } from "./locators/registry.ts";
import { restoreSourceLineEndings } from "./variables.ts";

export const PROJECT_SCHEMA = "program-studio-folder-project";
export const PROJECT_VERSION = 5;
export type ProjectSchemaVersion = typeof PROJECT_VERSION;
export type ProjectFileRole = LaunchFileRole;
export type ProjectLaunchMode = "direct" | "shell";

export interface ProjectFileEntry {
  path: string;
  roles: ProjectFileRole[];
}

export interface ProjectModule {
  name: string;
  files: string[];
  order: number;
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
  modules: ProjectModule[];
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
  path: string;
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
  modules?: ProjectModule[];
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

function expandProjectDirectoryMacro(
  value: string,
  projectDirectory: string | null,
  mode: "edit" | "run",
): string {
  if (mode !== "run" || !projectDirectory) return value;
  const nativeProjectPath = projectDirectory.includes("\\")
    ? projectDirectory.replace(/\//g, "\\")
    : projectDirectory.replace(/\\/g, "/");
  return value.replaceAll("#UCW_PRJ_DIR#", nativeProjectPath);
}

const FILE_ROLES = new Set<ProjectFileRole>([
  "input",
  "output-reference",
  "support",
  "program-entry",
  "template",
  "generated",
  "resource",
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
  explicitRoles?: LaunchFileRole[],
): ProjectFileRole[] {
  const roles = new Set<ProjectFileRole>(explicitRoles ?? []);
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

function fileStemFromPath(value: string): string {
  const baseName = normalizeRelativePath(value).split("/").at(-1) ?? value;
  const extensionIndex = baseName.lastIndexOf(".");
  return extensionIndex > 0 ? baseName.slice(0, extensionIndex) : baseName;
}

function packagedWorkingDirectory(snapshot: ProjectSnapshot): string {
  const configured = snapshot.workingDirectory.trim();
  return /^#UCW_PRJ_DIR#(?:[\\/]|$)/i.test(configured)
    ? configured
    : "files";
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
    referenceByStoredPath.set(entry.path, entry.path);
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
  path: string,
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
    if (!isRecord(binding) || binding.filePath !== path) {
      continue;
    }
    roles.add(
      binding.direction === "input" ? "input" : "output-reference",
    );
  }
  if (roles.size === 0) roles.add("support");
  return [...roles];
}

function parseProjectModules(
  value: unknown,
  files: ProjectFileEntry[],
  bindings: unknown[],
): ProjectModule[] {
  if (value !== undefined && !Array.isArray(value)) {
    throw new ProjectFormatError("工程模块清单必须是数组。");
  }
  const filePaths = new Set(files.map((file) => file.path));
  const modules = new Map<string, ProjectModule>();
  for (const [index, module] of (value ?? []).entries()) {
    if (!isRecord(module)) {
      throw new ProjectFormatError(`第 ${index + 1} 个模块配置无效。`);
    }
    const name = requiredString(
      module.name,
      `manifest.modules[${index}].name`,
    ).trim();
    if (!name || modules.has(name)) {
      throw new ProjectFormatError("模块名称不能为空或重复。");
    }
    if (!Array.isArray(module.files)) {
      throw new ProjectFormatError(`模块“${name}”缺少文件清单。`);
    }
    const moduleFiles = module.files.map((filePath) => {
      const normalized = normalizeRelativePath(
        requiredString(filePath, `manifest.modules[${index}].files`),
      );
      if (!filePaths.has(normalized)) {
        throw new ProjectFormatError(
          `模块“${name}”引用了未封装文件：${normalized}`,
        );
      }
      return normalized;
    });
    modules.set(name, {
      name,
      files: [...new Set(moduleFiles)],
      order:
        typeof module.order === "number" && Number.isFinite(module.order)
          ? module.order
          : index + 1,
    });
  }
  for (const binding of bindings) {
    if (
      !isRecord(binding) ||
      typeof binding.module !== "string" ||
      !binding.module.trim() ||
      typeof binding.filePath !== "string"
    ) {
      continue;
    }
    const name = binding.module.trim();
    const filePath = normalizeRelativePath(binding.filePath);
    if (!filePaths.has(filePath)) continue;
    const module = modules.get(name) ?? {
      name,
      files: [],
      order: modules.size + 1,
    };
    if (!module.files.includes(filePath)) module.files.push(filePath);
    modules.set(name, module);
  }
  return [...modules.values()].sort(
    (left, right) => left.order - right.order,
  );
}

function projectModules(
  files: ProjectFileEntry[],
  bindings: StoredLaunchBinding[],
  configured: ProjectModule[] | undefined,
): ProjectModule[] {
  const entries = new Map<
    string,
    { order: number; files: Set<string> }
  >();
  for (const module of configured ?? []) {
    const name = module.name.trim();
    if (!name) continue;
    entries.set(name, {
      order: module.order,
      files: new Set(module.files),
    });
  }
  for (const binding of bindings) {
    const filePath = binding.filePath;
    if (typeof filePath !== "string") continue;
    const moduleName = binding.module?.trim();
    if (!moduleName) continue;
    const entry = entries.get(moduleName) ?? {
      order: entries.size + 1,
      files: new Set<string>(),
    };
    entry.files.add(filePath);
    entries.set(moduleName, entry);
  }
  const knownFiles = new Set(files.map((file) => file.path));
  return [...entries]
    .map(([name, entry]) => ({
      name,
      order: entry.order,
      files: [...entry.files].filter((filePath) => knownFiles.has(filePath)),
    }))
    .filter((module) => module.files.length > 0)
    .sort((left, right) => left.order - right.order);
}

export function serializeProjectFolder(
  snapshot: ProjectSnapshot,
): ProjectFolderPayload {
  const now = new Date().toISOString();
  const name = snapshot.name.trim() || "未命名工程";
  const folderName = safeFileName(name, "program-project");
  const usedFileNames = new Set<string>();
  const files = snapshot.files.map((file, index) => ({
    path: (() => {
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
    roles: fileRoles(
      file.path,
      snapshot.bindings,
      file.roles,
    ),
  }));
  const projectPathByFilePath = new Map(
    snapshot.files.map((file, index) => [
      file.path,
      files[index].path,
    ]),
  );
  const usedOutputNames = new Set<string>();
  const inferredOutputReferences = new Set<string>();
  for (const binding of snapshot.bindings) {
    if (binding.direction !== "output" || !isFileBinding(binding)) continue;
    const projectPath = projectPathByFilePath.get(binding.filePath);
    if (projectPath) inferredOutputReferences.add(projectPath);
  }
  const outputs: ProjectOutputSpec[] =
    snapshot.outputs && snapshot.outputs.length > 0
      ? snapshot.outputs.map((output) => {
          const configuredReference = output.referenceFile
            ? normalizeRelativePath(output.referenceFile)
            : undefined;
          const referenceFile = configuredReference
            ? projectPathByFilePath.get(configuredReference) ??
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
  const outputNameByPath = new Map(
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
        module:
          binding.module ??
          (isFileBinding(binding)
            ? fileStemFromPath(binding.filePath)
            : undefined),
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
      const projectPath = projectPathByFilePath.get(binding.filePath);
      if (!projectPath) {
        throw new ProjectFormatError(
          `参数“${binding.name}”引用了未封装文件：${binding.filePath}`,
        );
      }
      return {
        ...common,
        direction: binding.direction,
        filePath: projectPath,
        locator: binding.locator,
        locatorInvalid: binding.locatorInvalid,
        ...(binding.direction === "output"
          ? {
              outputName:
                binding.outputName ??
                outputNameByPath.get(projectPath),
            }
          : {}),
      };
    },
  );
  const modules = projectModules(files, bindings, snapshot.modules);
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
    modules,
  };
  const pathReplacements = new Map(
    snapshot.files.map((file, index) => [
      file.path,
      files[index].path.replace(/^files\//, ""),
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
      path: files[index].path,
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
  if (
    rawManifest.schemaVersion !== PROJECT_VERSION &&
    rawManifest.schemaVersion !== 4
  ) {
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
      const path = requiredString(
        entry.path ?? entry.relativePath,
        "manifest.files.path",
      );
      return {
        path,
        roles: parseFileRoles(entry.roles, path, rawBindings),
      };
    },
  );
  const parsedModules = parseProjectModules(
    rawManifest.modules,
    parsedFileEntries,
    rawBindings,
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
        requiredString(file.path ?? file.relativePath, "files.path"),
        requiredString(file.content, "files.content"),
      ];
    }),
  );
  const folderPath =
    typeof payload.folderPath === "string" &&
    payload.folderPath.trim()
      ? payload.folderPath
      : null;
  const filePathByProjectPath = new Map<string, string>();
  const runtimePathByProjectPath = new Map<string, string>();
  const files = rawManifest.files.map((entry) => {
    if (!isRecord(entry)) {
      throw new ProjectFormatError("工程文件清单条目无效。");
    }
    const projectPath = requiredString(
      entry.path ?? entry.relativePath,
      "manifest.files.path",
    );
    const content = fileContentByPath.get(projectPath);
    if (content === undefined) {
      throw new ProjectFormatError(`工程缺少封装文件：${projectPath}`);
    }
    const runtimePath =
      parseMode === "run" && folderPath
        ? joinRuntimePath(folderPath, projectPath)
        : projectPath;
    const file = createLaunchFile(runtimePath, content);
    file.roles = parseFileRoles(
      entry.roles,
      projectPath,
      rawBindings,
    );
    runtimePathByProjectPath.set(projectPath, runtimePath);
    runtimePathByProjectPath.set(
      projectPath.replace(/^files\//, ""),
      runtimePath,
    );
    filePathByProjectPath.set(projectPath, file.path);
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
      filePathByProjectPath.get(
        outputSpec?.referenceFile ??
          normalizeRelativePath(storedFilePath),
      ) ??
      storedFilePath;
    const outputRelativePath =
      parseMode === "run"
        ? outputSpec?.runtimePath
        : outputSpec?.referenceFile;
    const filePath =
      outputRelativePath && folderPath && parseMode === "run"
        ? joinRuntimePath(folderPath, outputRelativePath)
        : outputRelativePath ?? referenceFilePath;
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
    const runtimeDefaultValue = expandProjectDirectoryMacro(
      defaultValue,
      folderPath,
      parseMode,
    );
    const module =
      typeof binding.module === "string" && binding.module.trim()
        ? binding.module.trim()
        : free
          ? undefined
          : fileStemFromPath(storedFilePath);
    const common = {
      name: requiredString(binding.name, `parameters[${index}].name`),
      ...(module ? { module } : {}),
      value: runtimeDefaultValue,
      parameterType: binding.parameterType,
      ...(inputReference ? { inputReference } : {}),
      ...(outputReference ? { outputReference } : {}),
      defaultValue: runtimeDefaultValue,
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
  const storedArguments = requiredString(
    payload.launch.arguments,
    "launch.arguments",
  );
  const launch: ProjectLaunchConfig = {
    mode: launchMode,
    program: requiredString(payload.launch.program, "launch.program"),
    arguments: storedArguments.includes("#UCW_PRJ_DIR#")
      ? expandProjectDirectoryMacro(
          storedArguments,
          folderPath,
          parseMode,
        )
      : replaceFilePaths(
          storedArguments,
          runtimePathByProjectPath,
        ),
    workingDirectory: (() => {
      const stored = requiredString(
        payload.launch.workingDirectory,
        "launch.workingDirectory",
      );
      const expanded = expandProjectDirectoryMacro(
        stored,
        folderPath,
        parseMode,
      );
      return parseMode === "run" &&
        folderPath &&
        !isAbsolutePath(expanded)
        ? joinRuntimePath(folderPath, expanded)
        : expanded;
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
    files: parsedFileEntries,
    modules: parsedModules,
  };
  return {
    manifest,
    launch,
    bindings,
    outputs: projectOutputs,
    files,
  };
}
