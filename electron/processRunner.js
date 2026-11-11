import { spawn } from "node:child_process";

const MAX_OUTPUT_BYTES = 1024 * 1024;

export function expandEnvironmentVariables(value, environment) {
  const missing = [];
  const expanded = String(value).replace(/%([^%]+)%/g, (match, name) => {
    const key = Object.keys(environment).find(
      (candidate) => candidate.toLowerCase() === name.toLowerCase(),
    );
    const replacement = key ? environment[key] : undefined;
    if (replacement === undefined) {
      missing.push(name);
      return match;
    }
    return replacement;
  });
  if (missing.length > 0) {
    throw new Error(
      `环境变量未设置：${[...new Set(missing)].join(", ")}`,
    );
  }
  return expanded;
}

function captureChunk(chunks, state, chunk) {
  if (state.bytes >= MAX_OUTPUT_BYTES) return;
  const remaining = MAX_OUTPUT_BYTES - state.bytes;
  const captured = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
  chunks.push(captured);
  state.bytes += captured.length;
}

export function runProgram(request) {
  if (!request || typeof request.program !== "string" || !request.program.trim()) {
    return Promise.reject(new Error("程序路径不能为空。"));
  }
  const args = Array.isArray(request.args)
    ? request.args.map((argument) => String(argument))
    : [];
  const environment = { ...process.env, ...request.environment };
  let program;
  let expandedArgs;
  let cwd;
  try {
    program = expandEnvironmentVariables(
      request.program.trim(),
      environment,
    );
    expandedArgs = args.map((argument) =>
      expandEnvironmentVariables(argument, environment),
    );
    cwd = request.cwd
      ? expandEnvironmentVariables(request.cwd, environment)
      : undefined;
  } catch (error) {
    return Promise.reject(error);
  }
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    const stdoutState = { bytes: 0 };
    const stderrState = { bytes: 0 };
    let settled = false;
    const child = spawn(program, expandedArgs, {
      cwd,
      shell: request.mode === "shell",
      windowsHide: true,
      env: environment,
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve({
        ...result,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        durationMs: Date.now() - startedAt,
      });
    };

    child.stdout.on("data", (chunk) => {
      captureChunk(stdoutChunks, stdoutState, chunk);
    });
    child.stderr.on("data", (chunk) => {
      captureChunk(stderrChunks, stderrState, chunk);
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
