import type {
  ProjectExecutionAdapter,
  ProjectProgramRequest,
  ProjectProgramResult,
} from "./projectExecution.ts";
import { assertInsideRoot } from "../../electron/projectPaths.js";

export interface DesktopExecutionAdapterOptions {
  writableRoot?: string;
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
        assertInsideRoot(
          filePath,
          writableRoot,
          `路径不在生成工程内：${filePath}`,
        );
      }
      const [file] = await api.readFiles([filePath]);
      return file
        ? { path: file.path, content: file.content }
        : null;
    },
    writeFiles(files) {
      if (writableRoot) {
        for (const file of files) {
          assertInsideRoot(
            file.path,
            writableRoot,
            `路径不在生成工程内：${file.path}`,
          );
        }
      }
      return api.writeFiles(files);
    },
    async runProgram(request: ProjectProgramRequest) {
      if (request.cwd && writableRoot) {
        assertInsideRoot(
          request.cwd,
          writableRoot,
          `路径不在生成工程内：${request.cwd}`,
        );
      }
      return api.runProgram({
        mode: request.mode,
        program: request.program,
        args: request.args,
        cwd: request.cwd,
        environment: request.environment,
      }) as Promise<ProjectProgramResult>;
    },
  };
}
