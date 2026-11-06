import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  ProjectExecutionAdapter,
  ProjectProgramRequest,
  ProjectProgramResult,
} from "./projectExecution.ts";
import { normalizeSourceText } from "./variables.ts";

const MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

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

function assertInsideRoot(
  targetPath: string,
  rootPath: string,
): string {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`路径不在生成工程内：${targetPath}`);
  }
  return target;
}

function runProgram(
  request: ProjectProgramRequest,
): Promise<ProjectProgramResult> {
  const timeoutMs = Math.max(
    1000,
    Math.min(
      Number(request.timeoutMs) || DEFAULT_TIMEOUT_MS,
      30 * 60 * 1000,
    ),
  );
  const startedAt = Date.now();
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(request.program, request.args, {
      cwd: request.cwd,
      shell: false,
      windowsHide: true,
      env: process.env,
    });

    const finish = (
      result: Omit<
        ProjectProgramResult,
        "stdout" | "stderr" | "durationMs"
      >,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ...result,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
    };

    const timer = setTimeout(() => {
      child.kill();
      finish({
        status: "timeout",
        exitCode: null,
        signal: null,
        error: `程序超过 ${timeoutMs} ms 未结束。`,
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) {
        stdout += chunk
          .toString("utf8")
          .slice(0, MAX_OUTPUT_BYTES - stdout.length);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) {
        stderr += chunk
          .toString("utf8")
          .slice(0, MAX_OUTPUT_BYTES - stderr.length);
      }
    });
    child.once("error", (error) => {
      finish({
        status: "failed",
        exitCode: null,
        signal: null,
        error: error.message,
      });
    });
    child.once("close", (exitCode, signal) => {
      finish({
        status: exitCode === 0 ? "completed" : "failed",
        exitCode,
        signal,
        error: null,
      });
    });
  });
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
        ? assertInsideRoot(filePath, writableRoot)
        : path.resolve(filePath);
      try {
        const buffer = await fs.readFile(targetPath);
        if (buffer.includes(0)) {
          throw new Error(`检测到二进制内容：${filePath}`);
        }
        return {
          path: filePath,
          content: normalizeSourceText(buffer.toString("utf8")),
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
          ? assertInsideRoot(file.path, writableRoot)
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
        assertInsideRoot(request.cwd, writableRoot);
      }
      return runProgram(request);
    },
  };
}
