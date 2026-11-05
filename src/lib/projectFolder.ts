import {
  createLaunchFile,
  type LaunchBinding,
  type LaunchFile,
  type LaunchLocator,
} from "./launcher.ts";

export const PROJECT_SCHEMA = "program-studio-folder-project";
export const PROJECT_VERSION = 1;

export interface ProjectFileEntry {
  path: string;
  relativePath: string;
}

export interface ProjectManifest {
  schema: typeof PROJECT_SCHEMA;
  schemaVersion: typeof PROJECT_VERSION;
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
  const files = snapshot.files.map((file, index) => ({
    path: file.path,
    relativePath: `files/${String(index + 1).padStart(3, "0")}-${safeFileName(
      file.name,
      "file.txt",
    )}`,
  }));
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
  return {
    folderName,
    manifest,
    launch: {
      program: snapshot.program,
      arguments: snapshot.arguments,
      workingDirectory: snapshot.workingDirectory,
    },
    parameters: { bindings: snapshot.bindings },
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
  if (rawManifest.schemaVersion !== PROJECT_VERSION) {
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
    return createLaunchFile(
      requiredString(entry.path, "manifest.files.path"),
      content,
    );
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
    const filePath = requiredString(
      binding.filePath,
      `parameters[${index}].filePath`,
    );
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
    return {
      id: requiredString(binding.id, `parameters[${index}].id`),
      name: requiredString(binding.name, `parameters[${index}].name`),
      direction,
      filePath,
      locator: binding.locator,
      value: requiredString(binding.value, `parameters[${index}].value`),
    } satisfies LaunchBinding;
  });

  const launch: ProjectLaunchConfig = {
    program: requiredString(payload.launch.program, "launch.program"),
    arguments: requiredString(
      payload.launch.arguments,
      "launch.arguments",
    ),
    workingDirectory: requiredString(
      payload.launch.workingDirectory,
      "launch.workingDirectory",
    ),
  };
  const manifest: ProjectManifest = {
    schema: PROJECT_SCHEMA,
    schemaVersion: PROJECT_VERSION,
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
