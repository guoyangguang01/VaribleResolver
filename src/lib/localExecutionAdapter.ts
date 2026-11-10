import fs from "node:fs/promises";
import path from "node:path";
import { assertInsideRoot } from "../../electron/projectPaths.js";
import { runProgram } from "../../electron/processRunner.js";
import type {
  ProjectExecutionAdapter,
  ProjectProgramRequest,
  ProjectProgramResult,
} from "./projectExecution.ts";

export interface LocalExecutionAdapterOptions {
  writableRoot?: string;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export function createLocalExecutionAdapter(
  options: LocalExecutionAdapterOptions = {},
): ProjectExecutionAdapter {
  const writableRoot = options.writableRoot
    ? path.resolve(options.writableRoot)
    : null;
  return {
    async readFile(filePath) {
      const targetPath = writableRoot
        ? assertInsideRoot(
            path.resolve(filePath),
            writableRoot,
            `路径不在生成工程内：${filePath}`,
          )
        : path.resolve(filePath);
      try {
        const buffer = await fs.readFile(targetPath);
        if (buffer.includes(0)) {
          throw new Error(`检测到二进制内容：${filePath}`);
        }
        return {
          path: filePath,
          content: buffer.toString("utf8"),
        };
      } catch (error) {
        if (isMissingFileError(error)) return null;
        throw error;
      }
    },
    async writeFiles(files) {
      const written: string[] = [];
      for (const file of files) {
        const targetPath = writableRoot
          ? assertInsideRoot(
              path.resolve(file.path),
              writableRoot,
              `路径不在生成工程内：${file.path}`,
            )
          : path.resolve(file.path);
        await fs.mkdir(path.dirname(targetPath), {
          recursive: true,
        });
        await fs.writeFile(targetPath, file.content, "utf8");
        written.push(targetPath);
      }
      return written;
    },
    async runProgram(request) {
      if (request.cwd && writableRoot) {
        assertInsideRoot(
          path.resolve(request.cwd),
          writableRoot,
          `路径不在生成工程内：${request.cwd}`,
        );
      }
      return runProgram(request);
    },
  };
}
