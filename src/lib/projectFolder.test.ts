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
        id: "time",
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
  assert.equal(project.files.length, 1);
  assert.equal(project.files[0].relativePath, "files/CFX1.ccl");
  assert.equal(project.files[0].content, "Total Time = 0.04 [s]");
  assert.equal(project.launch.program, "C:\\Tools\\runner.exe");
  assert.equal(project.parameters.bindings.length, 1);
  assert.equal(
    project.parameters.bindings[0].filePath,
    project.manifest.files[0].relativePath,
  );
  assert.doesNotMatch(
    project.parameters.bindings[0].filePath,
    /^[A-Za-z]:[\\/]/,
  );
  assert.equal(project.manifest.schemaVersion, 3);
  assert.equal(project.launch.workingDirectory, "files");
  assert.equal(project.parameters.bindings[0].parameterType, "number");
  assert.equal(project.parameters.bindings[0].defaultValue, "0.01");
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
  assert.equal(parsed.bindings[0].unit, "s");
  assert.equal(parsed.bindings[0].description, "计算总时长");
  assert.equal(
    parsed.launch.workingDirectory,
    "D:\\Generated\\fa1\\files",
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

test("loads an existing v2 project that still stores absolute binding paths", () => {
  const project = JSON.parse(
    JSON.stringify(sampleProject()),
  ) as ProjectFolderPayload;
  project.parameters.bindings[0].filePath =
    project.manifest.files[0].path;

  const parsed = parseProjectFolder({
    ...project,
    folderPath: "D:\\Generated\\legacy",
  });

  assert.equal(
    parsed.bindings[0].filePath,
    "D:\\Generated\\legacy\\files\\CFX1.ccl",
  );
  assert.equal(parsed.bindings[0].filePath, parsed.files[0].path);
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
