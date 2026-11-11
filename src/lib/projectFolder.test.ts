import assert from "node:assert/strict";
import test from "node:test";
import { createLaunchFile } from "./launcher.ts";
import {
  parseProjectFolder,
  serializeProjectFolder,
  type ProjectFolderPayload,
} from "./projectFolder.ts";

function sampleProject(): ProjectFolderPayload {
  const config = createLaunchFile(
    "C:\\Cases\\fa1\\CFX1.ccl",
    "Total Time = 0.04 [s]",
  );
  return serializeProjectFolder({
    name: "fa1 示例工程",
    program: "C:\\Tools\\runner.exe",
    arguments: "--config CFX1.ccl",
    workingDirectory: "C:\\Cases\\fa1",
    files: [config],
    bindings: [
      {
        name: "总时长",
        direction: "input",
        filePath: config.path,
        locator: {
          kind: "autoPosition",
          startRowIndex: 1,
          startColumnIndex: 13,
          endRowIndex: 1,
          endColumnIndex: 17,
        },
        value: "0.04",
        parameterType: "number",
        defaultValue: "0.01",
        unit: "s",
        description: "计算总时长",
      },
    ],
  });
}

test("serializes a folder project with separate launch and parameter files", () => {
  const project = sampleProject();

  assert.equal(project.folderName, "fa1 示例工程");
  assert.equal(project.manifest.launchFile, "launch.json");
  assert.equal(project.manifest.parameterFile, "parameters.json");
  assert.equal(project.manifest.outputFile, "outputs.json");
  assert.equal(project.files.length, 1);
  assert.equal(project.files[0].relativePath, "files/CFX1.ccl");
  assert.equal(project.files[0].content, "Total Time = 0.04 [s]");
  assert.equal(project.launch.program, "C:\\Tools\\runner.exe");
  assert.equal(project.parameters.bindings.length, 1);
  assert.equal("id" in project.parameters.bindings[0], false);
  assert.equal(
    project.parameters.bindings[0].filePath,
    project.manifest.files[0].relativePath,
  );
  assert.doesNotMatch(
    project.parameters.bindings[0].filePath,
    /^[A-Za-z]:[\\/]/,
  );
  assert.equal(project.manifest.schemaVersion, 4);
  assert.equal(project.launch.mode, "direct");
  assert.equal(project.launch.workingDirectory, "files");
  assert.deepEqual(project.manifest.files[0].roles, ["input"]);
  assert.deepEqual(project.outputs.outputs, []);
  assert.equal(project.parameters.bindings[0].parameterType, "number");
  assert.equal(project.parameters.bindings[0].defaultValue, "0.01");
  assert.equal("value" in project.parameters.bindings[0], false);
  assert.equal(project.parameters.bindings[0].unit, "s");
  assert.equal(project.parameters.bindings[0].description, "计算总时长");
});

test("parses a folder project with its generated project path", () => {
  const project = JSON.parse(
    JSON.stringify(sampleProject()),
  ) as ProjectFolderPayload;
  const parsed = parseProjectFolder({
    ...project,
    folderPath: "D:\\Generated\\fa1",
  });

  assert.equal(parsed.manifest.name, "fa1 示例工程");
  assert.equal(
    parsed.launch.arguments,
    "--config D:\\Generated\\fa1\\files\\CFX1.ccl",
  );
  assert.equal(parsed.files.length, 1);
  assert.equal(
    parsed.files[0].path,
    "D:\\Generated\\fa1\\files\\CFX1.ccl",
  );
  assert.equal(parsed.files[0].content, "Total Time = 0.04 [s]");
  assert.equal(parsed.bindings.length, 1);
  assert.equal(parsed.bindings[0].filePath, parsed.files[0].path);
  assert.equal(parsed.bindings[0].name, "总时长");
  assert.equal(parsed.bindings[0].parameterType, "number");
  assert.equal(parsed.bindings[0].defaultValue, "0.01");
  assert.equal(parsed.bindings[0].value, "0.01");
  assert.equal(parsed.bindings[0].unit, "s");
  assert.equal(parsed.bindings[0].description, "计算总时长");
  assert.equal(
    parsed.launch.workingDirectory,
    "D:\\Generated\\fa1\\files",
  );
});

test("ignores legacy persisted runtime values and initializes them from defaults", () => {
  const project = JSON.parse(
    JSON.stringify(sampleProject()),
  ) as ProjectFolderPayload & {
    parameters: { bindings: Array<Record<string, unknown>> };
  };
  project.parameters.bindings[0].value = "0.04";

  const parsed = parseProjectFolder(project);

  assert.equal(parsed.bindings[0].defaultValue, "0.01");
  assert.equal(parsed.bindings[0].value, "0.01");
});

test("normalizes project file contents in memory without changing the payload", () => {
  const project = sampleProject();
  project.files[0].content = "Total Time = 0.04 [s]\r\n";

  const parsed = parseProjectFolder(project);

  assert.equal(parsed.files[0].content, "Total Time = 0.04 [s]\n");
  assert.equal(parsed.files[0].lineEnding, "\r\n");
  assert.equal(project.files[0].content, "Total Time = 0.04 [s]\r\n");
});

test("preserves each file line ending across a project round trip", () => {
  for (const lineEnding of ["\n", "\r\n", "\r"] as const) {
    const source = `first = 1${lineEnding}second = 2${lineEnding}`;
    const sourceFile = createLaunchFile(
      `C:\\Cases\\line-endings-${lineEnding.length}.txt`,
      source,
    );
    const project = serializeProjectFolder({
      name: "换行风格工程",
      program: "C:\\Tools\\runner.exe",
      arguments: "",
      workingDirectory: "C:\\Cases",
      files: [sourceFile],
      bindings: [],
    });

    assert.equal(project.files[0].content, source);
    const parsed = parseProjectFolder(project);
    assert.equal(parsed.files[0].content, "first = 1\nsecond = 2\n");
    assert.equal(parsed.files[0].lineEnding, lineEnding);
  }
});

test("separates reference outputs from runtime output paths", () => {
  const inputFile = createLaunchFile(
    "C:\\Cases\\output-contract\\input.ccl",
    "temperature = 20\n",
  );
  const referenceFile = createLaunchFile(
    "C:\\Cases\\output-contract\\report.txt",
    "maximum = 10\n",
  );
  const project = serializeProjectFolder({
    name: "输出契约工程",
    program: "C:\\Tools\\runner.exe",
    arguments: "--input input.ccl",
    workingDirectory: "C:\\Cases\\output-contract",
    files: [inputFile, referenceFile],
    bindings: [
      {
        name: "温度",
        direction: "input",
        filePath: inputFile.path,
        locator: {
          kind: "rowColumn",
          startRowIndex: 1,
          startColumnIndex: 14,
          endRowIndex: 1,
          endColumnIndex: 16,
        },
        value: "20",
        parameterType: "number",
        defaultValue: "20",
        unit: "C",
        description: "",
      },
      {
        name: "最大值",
        direction: "output",
        filePath: referenceFile.path,
        locator: {
          kind: "rowColumn",
          startRowIndex: 1,
          startColumnIndex: 10,
          endRowIndex: 1,
          endColumnIndex: 12,
        },
        value: "10",
        parameterType: "number",
        defaultValue: "10",
        unit: "",
        description: "",
      },
    ],
  });

  assert.deepEqual(project.outputs.outputs, [
    {
      name: "report",
      referenceFile: "files/report.txt",
      runtimePath: "files/report.txt",
      required: true,
      seed: "never",
      discovery: { type: "path" },
    },
  ]);
  assert.equal(project.parameters.bindings[1].outputName, "report");
  assert.equal(project.manifest.files[1].roles.includes("output-reference"), true);

  project.outputs.outputs[0].runtimePath = "files/runtime-report.txt";
  const parsed = parseProjectFolder(
    {
      ...project,
      folderPath: "D:\\Runs\\output-contract",
    },
    { mode: "run" },
  );
  assert.equal(
    parsed.bindings[1].filePath,
    "D:\\Runs\\output-contract\\files\\runtime-report.txt",
  );
});

test("preserves input references across multiple files", () => {
  const primaryFile = createLaunchFile(
    "C:\\Cases\\refs\\primary.txt",
    "value = 10\n",
  );
  const aliasFile = createLaunchFile(
    "C:\\Cases\\refs\\alias.txt",
    "value = 10\n",
  );
  const locator = {
    kind: "rowColumn" as const,
    startRowIndex: 1,
    startColumnIndex: 8,
    endRowIndex: 1,
    endColumnIndex: 10,
  };
  const project = serializeProjectFolder({
    name: "输入引用",
    program: "C:\\Tools\\runner.exe",
    arguments: "--value @primary[In].主参数",
    workingDirectory: "C:\\Cases\\refs",
    files: [primaryFile, aliasFile],
    bindings: [
      {
        name: "主参数",
        direction: "input",
        filePath: primaryFile.path,
        locator,
        value: "10",
        parameterType: "number",
        defaultValue: "10",
        unit: "",
        description: "",
      },
      {
        name: "副本参数",
        direction: "input",
        filePath: aliasFile.path,
        inputReference: "@primary[In].主参数",
        locator,
        value: "10",
        parameterType: "number",
        defaultValue: "10",
        unit: "",
        description: "",
      },
    ],
  });

  assert.equal(
    project.parameters.bindings[1].inputReference,
    "@primary[In].主参数",
  );
  const parsed = parseProjectFolder(project);
  assert.equal(parsed.bindings[1].inputReference, "@primary[In].主参数");
});

test("rejects references on file-bound output parameters", () => {
  const project = sampleProject();
  project.parameters.bindings[0] = {
    ...project.parameters.bindings[0],
    direction: "output",
    inputReference: "@primary[In].主参数",
  };

  assert.throws(
    () => parseProjectFolder(project),
    /不能使用输入参数引用/,
  );
});

test("persists free input parameters without file or locator bindings", () => {
  const project = sampleProject();
  project.parameters.bindings.push({
    scope: "free",
    name: "材料",
    direction: "input",
    parameterType: "text",
    defaultValue: "steel",
    unit: "",
    description: "手动输入",
  });
  project.parameters.bindings.push({
    scope: "free",
    name: "自由最大值",
    direction: "output",
    outputReference: "@CFX1[Out].总时长",
    parameterType: "number",
    defaultValue: "",
    unit: "s",
    description: "引用输出",
  });
  const parsed = parseProjectFolder(project);
  const free = parsed.bindings[1];

  assert.equal(free.scope, "free");
  assert.equal(free.name, "材料");
  assert.equal("filePath" in free, false);
  assert.equal("locator" in free, false);
  assert.equal(parsed.bindings[1].value, "steel");
  assert.equal(parsed.bindings[2].direction, "output");
  assert.equal(
    parsed.bindings[2].outputReference,
    "@CFX1[Out].总时长",
  );
});

test("rewrites source file paths to generated project files", () => {
  const config = createLaunchFile(
    "C:\\Cases\\fa1\\CFX1.ccl",
    "Total Time = 0.04 [s]",
  );
  const project = serializeProjectFolder({
    name: "路径工程",
    program: "C:\\Tools\\runner.exe",
    arguments: '--config "C:\\Cases\\fa1\\CFX1.ccl"',
    workingDirectory: "C:\\Cases\\fa1",
    files: [config],
    bindings: [],
  });

  assert.equal(project.launch.arguments, '--config "CFX1.ccl"');
  const parsed = parseProjectFolder({
    ...project,
    folderPath: "D:\\Generated\\path-project",
  });
  assert.equal(
    parsed.launch.arguments,
    '--config "D:\\Generated\\path-project\\files\\CFX1.ccl"',
  );
});

test("maps the source directory to files but preserves a custom working directory", () => {
  const config = createLaunchFile(
    "C:\\Cases\\fa1\\CFX1.ccl",
    "Total Time = 0.04 [s]",
  );
  const custom = serializeProjectFolder({
    name: "自定义工作目录",
    program: "C:\\Tools\\runner.exe",
    arguments: "",
    workingDirectory: "D:\\Shared\\runtime",
    files: [config],
    bindings: [],
  });
  assert.equal(custom.launch.workingDirectory, "D:\\Shared\\runtime");

  const parsed = parseProjectFolder({
    ...custom,
    folderPath: "D:\\Generated\\custom-working-directory",
  });
  assert.equal(parsed.launch.workingDirectory, "D:\\Shared\\runtime");
});

test("preserves the original source path across a project round trip", () => {
  const originalPath = "C:\\Cases\\fa1\\CFX1.ccl";
  const config = createLaunchFile(
    "C:\\Cases\\fa1\\working\\CFX1.ccl",
    "Total Time = 0.04 [s]",
    originalPath,
  );
  const project = serializeProjectFolder({
    name: "原文件工程",
    program: "C:\\Tools\\runner.exe",
    arguments: '--config "C:\\Cases\\fa1\\working\\CFX1.ccl"',
    workingDirectory: "C:\\Cases\\fa1\\working",
    files: [config],
    bindings: [],
  });

  assert.equal(project.manifest.files[0].path, originalPath);
  const parsed = parseProjectFolder({
    ...project,
    folderPath: "D:\\Generated\\original-project",
  });
  assert.equal(
    parsed.files[0].path,
    "D:\\Generated\\original-project\\files\\CFX1.ccl",
  );
  assert.equal(parsed.files[0].sourcePath, originalPath);
  assert.equal(parsed.files[0].sourceContent, "Total Time = 0.04 [s]");

  const reserialized = serializeProjectFolder({
    name: parsed.manifest.name,
    program: parsed.launch.program,
    arguments: parsed.launch.arguments,
    workingDirectory: parsed.launch.workingDirectory,
    files: parsed.files,
    bindings: parsed.bindings,
    createdAt: parsed.manifest.createdAt,
  });
  assert.equal(reserialized.manifest.files[0].path, originalPath);
  assert.equal(
    reserialized.files[0].relativePath,
    project.files[0].relativePath,
  );
});

test("preserves locator invalid state in a folder project", () => {
  const project = sampleProject();
  project.parameters.bindings[0].locatorInvalid = true;

  const parsed = parseProjectFolder({
    ...project,
    folderPath: "D:\\Generated\\invalid-locator",
  });

  assert.equal(parsed.bindings[0].locatorInvalid, true);
});

test("rejects duplicate parameter composite keys", () => {
  const duplicate = JSON.parse(
    JSON.stringify(sampleProject()),
  ) as ProjectFolderPayload;
  duplicate.parameters.bindings.push({
    ...duplicate.parameters.bindings[0],
  });
  assert.throws(
    () => parseProjectFolder(duplicate),
    /参数主键重复：CFX1\.ccl\.总时长/,
  );
});

test("rejects a folder project that references a missing file", () => {
  const project = sampleProject();
  project.files = [];

  assert.throws(
    () => parseProjectFolder(project),
    /工程缺少封装文件/,
  );
});

test("rejects the previous folder project version", () => {
  const project = sampleProject();
  project.manifest = {
    ...project.manifest,
    schemaVersion: 1,
  } as unknown as typeof project.manifest;

  assert.throws(
    () => parseProjectFolder(project),
    /不支持的工程版本/,
  );
});
