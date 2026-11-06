import type {
  ProjectExecutionAdapter,
  ProjectProgramRequest,
  ProjectProgramResult,
} from "./projectExecution.ts";

export interface DesktopExecutionAdapterOptions {
  writableRoot?: string;
}

function normalizePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function assertInsideRoot(
  targetPath: string,
  rootPath: string,
): void {
  const root = normalizePath(rootPath);
  const target = normalizePath(targetPath);
  if (target !== root && !target.startsWith(`${root}/`)) {
    throw new Error(`路径不在生成工程内：${targetPath}`);
  }
}

export function createDesktopExecutionAdapter(
  api: ProgramStudioApi,
  options: DesktopExecutionAdapterOptions = {},
): ProjectExecutionAdapter {
  const writableRoot = options.writableRoot
    ? options.writableRoot
    : null;
  return {
    async readFile(filePath) {
      if (writableRoot) {
        assertInsideRoot(filePath, writableRoot);
      }
      const [file] = await api.readFiles([filePath]);
      return file
        ? { path: file.path, content: file.content }
        : null;
    },
    writeFiles(files) {
      if (writableRoot) {
        for (const file of files) {
          assertInsideRoot(file.path, writableRoot);
        }
      }
      return api.writeFiles(files);
    },
    async runProgram(request: ProjectProgramRequest) {
      if (request.cwd && writableRoot) {
        assertInsideRoot(request.cwd, writableRoot);
      }
      return api.runProgram({
        program: request.program,
        args: request.args,
        cwd: request.cwd,
        timeoutMs: request.timeoutMs,
      }) as Promise<ProjectProgramResult>;
    },
  };
}
