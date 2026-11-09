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
import { assertInsideRoot } from "../electron/projectPaths.js";
import { createProjectRunWorkspace } from "../electron/runWorkspace.js";

interface CliOptions {
  projectDirectory: string;
  overrides: ProjectInputOverride[];
  requestFile: string | null;
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
    "  --set <文件名.参数名=值> 按复合主键覆盖输入参数，可重复",
    "  --request <JSON 文件>    使用标准运行请求文件",
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

function parameterOverride(expression: string): ProjectInputOverride {
  const [key, value] = parseSelectorValue(expression, "--set");
  const separator = key.lastIndexOf(".");
  if (separator <= 0 || separator === key.length - 1) {
    throw new Error(
      `--set 主键格式无效：“${key}”，应为 文件名.参数名=值。`,
    );
  }
  return {
    fileName: key.slice(0, separator).trim(),
    parameterName: key.slice(separator + 1).trim(),
    value,
  };
}

function parseArguments(args: string[]): CliOptions {
  let projectDirectory = "";
  let requestFile: string | null = null;
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
    if (argument === "--set") {
      overrides.push(
        parameterOverride(
          requireNextArgument(args, index, "--set"),
        ),
      );
      index += 1;
      continue;
    }
    const inlineSet = optionValue(argument, "--set");
    if (inlineSet !== null) {
      overrides.push(parameterOverride(inlineSet));
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
    if (!argument.startsWith("--") && !projectDirectory) {
      projectDirectory = argument;
      continue;
    }
    throw new Error(`未知参数：${argument}`);
  }

  if (!projectDirectory) {
    throw new Error("必须使用 --project 指定工程目录。");
  }
  return {
    projectDirectory,
    overrides,
    requestFile,
  };
}

function resolveInsideProject(
  projectDirectory: string,
  relativePath: string,
): string {
  const root = path.resolve(projectDirectory);
  const target = path.resolve(root, relativePath);
  return assertInsideRoot(
    target,
    root,
    `工程文件路径越界：${relativePath}`,
  );
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
  mode: "edit" | "run" = "edit",
): Promise<LoadedProject> {
  const root = path.resolve(projectDirectory);
  const manifest = await readJson(path.join(root, "project.json"));
  const launch = await readJson(path.join(root, "launch.json"));
  const parameters = await readJson(
    path.join(root, "parameters.json"),
  );
  const outputs = await readJson(path.join(root, "outputs.json"));
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
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch (error) {
      const roles =
        "roles" in entry && Array.isArray(entry.roles)
          ? entry.roles
          : [];
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT" &&
        roles.includes("output-reference") &&
        !roles.includes("input") &&
        !roles.includes("support") &&
        !roles.includes("program-entry")
      ) {
        content = "";
      } else {
        throw error;
      }
    }
    files.push({
      relativePath: entry.relativePath,
      content: normalizeSourceText(content),
    });
  }

  const parsed = parseProjectFolder(
    {
      folderPath: root,
      manifest,
      launch,
      parameters,
      outputs,
      files,
    },
    { mode },
  );
  return {
    path: root,
    name: parsed.manifest.name,
    snapshot: {
      program: parsed.launch.program,
      arguments: parsed.launch.arguments,
      workingDirectory: parsed.launch.workingDirectory,
      launchMode: parsed.launch.mode,
      environment: parsed.launch.environment,
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
  const definition = await loadProject(options.projectDirectory);
  const runWorkspace = await createProjectRunWorkspace(
    definition.path,
  );
  const project = await loadProject(runWorkspace.path, "run");
  const adapter = createLocalExecutionAdapter({
    writableRoot: project.path,
  });
  const execution = await executeProjectWithOverrides({
    snapshot: project.snapshot,
    overrides,
    adapter,
  });

  console.log(
    JSON.stringify(
      {
        schema: "program-studio-project-run",
        schemaVersion: 2,
        project: {
          name: project.name,
          path: definition.path,
          runId: runWorkspace.runId,
          runPath: runWorkspace.path,
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
