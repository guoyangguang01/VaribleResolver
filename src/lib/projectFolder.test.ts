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
  assert.match(project.files[0].relativePath, /^files\/001-/);
  assert.equal(project.files[0].content, "Total Time = 0.04 [s]");
  assert.equal(project.launch.program, "C:\\Tools\\runner.exe");
  assert.equal(project.parameters.bindings.length, 1);
});

test("parses a folder project and restores all referenced files", () => {
  const project = JSON.parse(
    JSON.stringify(sampleProject()),
  ) as ProjectFolderPayload;
  const parsed = parseProjectFolder(project);

  assert.equal(parsed.manifest.name, "fa1 示例工程");
  assert.equal(parsed.launch.arguments, "--config CFX1.ccl");
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0].path, "C:\\Cases\\fa1\\CFX1.ccl");
  assert.equal(parsed.files[0].content, "Total Time = 0.04 [s]");
  assert.equal(parsed.bindings.length, 1);
  assert.equal(parsed.bindings[0].name, "总时长");
});

test("rejects a folder project that references a missing file", () => {
  const project = sampleProject();
  project.files = [];

  assert.throws(
    () => parseProjectFolder(project),
    /工程缺少封装文件/,
  );
});
