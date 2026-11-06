import fs from "node:fs/promises";
import path from "node:path";
import {
  parseProjectFolder,
} from "../src/lib/projectFolder.ts";
import {
  executeProjectWithOverrides,
  type ProjectInputOverride,
  type ProjectExecutionSnapshot,
} from "../src/lib/projectExecution.ts";
import { createLocalExecutionAdapter } from "../src/lib/localExecutionAdapter.ts";
import { parseRunRequest } from "../src/lib/runRequest.ts";
import { normalizeSourceText } from "../src/lib/variables.ts";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

interface CliOptions {
  projectDirectory: string;
  overrides: ProjectInputOverride[];
  requestFile: string | null;
  timeoutMs: number;
}

interface LoadedProject {
  path: string;
  name: string;
  snapshot: ProjectExecutionSnapshot;
}

function usage(): string {
  return [
    "用法：",
    "  npm run project:run -- --project <工程目录> [选项]",
    "",
    "选项：",
    "  --set-id <绑定ID=值>     按绑定 ID 覆盖输入参数，可重复",
    "  --set-name <参数名=值>   按唯一参数名称覆盖，可重复",
    "  --request <JSON 文件>    使用标准运行请求文件",
    "  --timeout-ms <毫秒>      程序超时时间，默认 600000",
    "  --help                   显示帮助",
  ].join("\n");
}

function optionValue(
  argument: string,
  optionName: string,
): string | null {
  const prefix = `${optionName}=`;
  return argument.startsWith(prefix)
    ? argument.slice(prefix.length)
    : null;
}

function requireNextArgument(
  args: string[],
  index: number,
  option: string,
): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} 缺少参数值。`);
  }
  return value;
}

function parseSelectorValue(
  expression: string,
  option: string,
): [string, string] {
  const separator = expression.indexOf("=");
  if (separator <= 0) {
    throw new Error(
      `${option} 格式无效：“${expression}”，应为 选择器=值。`,
    );
  }
  const selector = expression.slice(0, separator).trim();
  if (!selector) {
    throw new Error(`${option} 的选择器不能为空。`);
  }
  return [selector, expression.slice(separator + 1)];
}

function parseArguments(args: string[]): CliOptions {
  let projectDirectory = "";
  let requestFile: string | null = null;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  const overrides: ProjectInputOverride[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (argument === "--project") {
      projectDirectory = requireNextArgument(
        args,
        index,
        "--project",
      );
      index += 1;
      continue;
    }
    const inlineProject = optionValue(argument, "--project");
    if (inlineProject !== null) {
      projectDirectory = inlineProject;
      continue;
    }
    if (argument === "--set-id") {
      const [bindingId, value] = parseSelectorValue(
        requireNextArgument(args, index, "--set-id"),
        "--set-id",
      );
      overrides.push({ target: "bindingId", bindingId, value });
      index += 1;
      continue;
    }
    const inlineSetId = optionValue(argument, "--set-id");
    if (inlineSetId !== null) {
      const [bindingId, value] = parseSelectorValue(
        inlineSetId,
        "--set-id",
      );
      overrides.push({ target: "bindingId", bindingId, value });
      continue;
    }
    if (argument === "--set-name") {
      const [name, value] = parseSelectorValue(
        requireNextArgument(args, index, "--set-name"),
        "--set-name",
      );
      overrides.push({ target: "name", name, value });
      index += 1;
      continue;
    }
    const inlineSetName = optionValue(argument, "--set-name");
    if (inlineSetName !== null) {
      const [name, value] = parseSelectorValue(
        inlineSetName,
        "--set-name",
      );
      overrides.push({ target: "name", name, value });
      continue;
    }
    if (argument === "--request") {
      requestFile = requireNextArgument(
        args,
        index,
        "--request",
      );
      index += 1;
      continue;
    }
    const inlineRequest = optionValue(argument, "--request");
    if (inlineRequest !== null) {
      requestFile = inlineRequest;
      continue;
    }
    if (argument === "--timeout-ms") {
      timeoutMs = Number(
        requireNextArgument(args, index, "--timeout-ms"),
      );
      index += 1;
      continue;
    }
    const inlineTimeout = optionValue(argument, "--timeout-ms");
    if (inlineTimeout !== null) {
      timeoutMs = Number(inlineTimeout);
      continue;
    }
    if (!argument.startsWith("--") && !projectDirectory) {
      projectDirectory = argument;
      continue;
    }
    throw new Error(`未知参数：${argument}`);
  }

  if (!projectDirectory) {
    throw new Error("必须使用 --project 指定工程目录。");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) {
    throw new Error("--timeout-ms 必须是不小于 1000 的数字。");
  }
  return {
    projectDirectory,
    overrides,
    requestFile,
    timeoutMs,
  };
}

function resolveInsideProject(
  projectDirectory: string,
  relativePath: string,
): string {
  const root = path.resolve(projectDirectory);
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`工程文件路径越界：${relativePath}`);
  }
  return target;
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
}

async function loadRequestFile(
  filePath: string,
): Promise<ProjectInputOverride[]> {
  return parseRunRequest(await readJson(filePath));
}

async function loadProject(
  projectDirectory: string,
): Promise<LoadedProject> {
  const root = path.resolve(projectDirectory);
  const manifest = await readJson(path.join(root, "project.json"));
  const launch = await readJson(path.join(root, "launch.json"));
  const parameters = await readJson(
    path.join(root, "parameters.json"),
  );
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("files" in manifest) ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error("project.json 缺少 files 文件清单。");
  }

  const files = [];
  for (const entry of manifest.files) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("relativePath" in entry) ||
      typeof entry.relativePath !== "string"
    ) {
      throw new Error("project.json 中存在无效文件条目。");
    }
    const filePath = resolveInsideProject(root, entry.relativePath);
    files.push({
      relativePath: entry.relativePath,
      content: normalizeSourceText(
        await fs.readFile(filePath, "utf8"),
      ),
    });
  }

  const parsed = parseProjectFolder({
    folderPath: root,
    manifest,
    launch,
    parameters,
    files,
  });
  return {
    path: root,
    name: parsed.manifest.name,
    snapshot: {
      program: parsed.launch.program,
      arguments: parsed.launch.arguments,
      workingDirectory: parsed.launch.workingDirectory,
      files: parsed.files,
      bindings: parsed.bindings,
    },
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const fileOverrides = options.requestFile
    ? await loadRequestFile(path.resolve(options.requestFile))
    : [];
  const overrides = [...fileOverrides, ...options.overrides];
  const project = await loadProject(options.projectDirectory);
  const adapter = createLocalExecutionAdapter({
    writableRoot: project.path,
  });
  const execution = await executeProjectWithOverrides({
    snapshot: project.snapshot,
    overrides,
    adapter,
    timeoutMs: options.timeoutMs,
  });

  console.log(
    JSON.stringify(
      {
        schema: "program-studio-project-run",
        schemaVersion: 2,
        project: {
          name: project.name,
          path: project.path,
        },
        overrides,
        execution,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.stack ?? error.message : error,
  );
  process.exitCode = 1;
});
