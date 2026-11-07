import {
  createLaunchFile,
  isLaunchParameterType,
  type LaunchBinding,
  type LaunchFile,
  type LaunchLocator,
} from "./launcher.ts";

export const PROJECT_SCHEMA = "program-studio-folder-project";
export const PROJECT_VERSION = 3;
export type ProjectSchemaVersion = 2 | typeof PROJECT_VERSION;

export interface ProjectFileEntry {
  path: string;
  relativePath: string;
}

export interface ProjectManifest {
  schema: typeof PROJECT_SCHEMA;
  schemaVersion: ProjectSchemaVersion;
  name: string;
  createdAt: string;
  updatedAt: string;
  launchFile: "launch.json";
  parameterFile: "parameters.json";
  files: ProjectFileEntry[];
}

export interface ProjectLaunchConfig {
  program: string;
  arguments: string;
  workingDirectory: string;
}

export interface ProjectParameterConfig {
  bindings: LaunchBinding[];
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
  files: ProjectFolderFile[];
}

export interface ProjectSnapshot {
  name: string;
  program: string;
  arguments: string;
  workingDirectory: string;
  files: LaunchFile[];
  bindings: LaunchBinding[];
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

const LOCATOR_KINDS = new Set<LaunchLocator["kind"]>([
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
]);

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

function validLocator(value: unknown): value is LaunchLocator {
  return (
    isRecord(value) &&
    typeof value.kind === "string" &&
    LOCATOR_KINDS.has(value.kind as LaunchLocator["kind"])
  );
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
  const bindings = snapshot.bindings.map((binding) => {
    const relativePath = relativePathByFilePath.get(binding.filePath);
    if (!relativePath) {
      throw new ProjectFormatError(
        `参数“${binding.name}”引用了未封装文件：${binding.filePath}`,
      );
    }
    return { ...binding, filePath: relativePath };
  });
  const manifest: ProjectManifest = {
    schema: PROJECT_SCHEMA,
    schemaVersion: PROJECT_VERSION,
    name,
    createdAt: snapshot.createdAt ?? now,
    updatedAt: now,
    launchFile: "launch.json",
    parameterFile: "parameters.json",
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
      program: snapshot.program,
      arguments: replaceFilePaths(
        snapshot.arguments,
        pathReplacements,
      ),
      workingDirectory: "files",
    },
    parameters: { bindings },
    files: snapshot.files.map((file, index) => ({
      relativePath: files[index].relativePath,
      content: file.content,
    })),
  };
}

export function parseProjectFolder(payload: unknown): {
  manifest: ProjectManifest;
  launch: ProjectLaunchConfig;
  bindings: LaunchBinding[];
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
    rawManifest.schemaVersion !== 2 &&
    rawManifest.schemaVersion !== PROJECT_VERSION
  ) {
    throw new ProjectFormatError(
      `不支持的工程版本：${String(rawManifest.schemaVersion)}`,
    );
  }
  if (!isRecord(payload.launch) || !isRecord(payload.parameters)) {
    throw new ProjectFormatError(
      "工程目录缺少 launch.json 或 parameters.json。",
    );
  }
  if (
    !Array.isArray(rawManifest.files) ||
    !Array.isArray(payload.files) ||
    !Array.isArray(payload.parameters.bindings)
  ) {
    throw new ProjectFormatError("工程文件清单或参数列表无效。");
  }

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
    const storedFilePath = requiredString(
      binding.filePath,
      `parameters[${index}].filePath`,
    );
    const filePath =
      filePathByRelativePath.get(storedFilePath) ??
      filePathBySourcePath.get(storedFilePath) ??
      storedFilePath;
    if (!filePaths.has(filePath)) {
      throw new ProjectFormatError(
        `第 ${index + 1} 个参数引用了未封装文件：${filePath}`,
      );
    }
    if (!validLocator(binding.locator)) {
      throw new ProjectFormatError(
        `第 ${index + 1} 个参数定位模式无效。`,
      );
    }
    const value = requiredString(
      binding.value,
      `parameters[${index}].value`,
    );
    if (!isLaunchParameterType(binding.parameterType)) {
      throw new ProjectFormatError(
        `第 ${index + 1} 个参数类型无效。`,
      );
    }
    return {
      id: requiredString(binding.id, `parameters[${index}].id`),
      name: requiredString(binding.name, `parameters[${index}].name`),
      direction,
      filePath,
      locator: binding.locator,
      value,
      parameterType: binding.parameterType,
      defaultValue: requiredString(
        binding.defaultValue,
        `parameters[${index}].defaultValue`,
      ),
      unit: requiredString(
        binding.unit,
        `parameters[${index}].unit`,
      ),
      description: requiredString(
        binding.description,
        `parameters[${index}].description`,
      ),
    } satisfies LaunchBinding;
  });

  const launch: ProjectLaunchConfig = {
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
  };
  const manifest: ProjectManifest = {
    schema: PROJECT_SCHEMA,
    schemaVersion:
      rawManifest.schemaVersion === 2
        ? 2
        : PROJECT_VERSION,
    name: requiredString(rawManifest.name, "manifest.name"),
    createdAt: requiredString(rawManifest.createdAt, "manifest.createdAt"),
    updatedAt: requiredString(rawManifest.updatedAt, "manifest.updatedAt"),
    launchFile: "launch.json",
    parameterFile: "parameters.json",
    files: rawManifest.files.map((entry) => {
      const record = entry as Record<string, unknown>;
      return {
        path: requiredString(record.path, "manifest.files.path"),
        relativePath: requiredString(
          record.relativePath,
          "manifest.files.relativePath",
        ),
      };
    }),
  };
  return { manifest, launch, bindings, files };
}
