const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `CLI exited with ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        );
      }
    });
  });
}

test("project CLI runs in an isolated workspace and extracts a new output", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "program-studio-cli-"),
  );
  const project = path.join(root, "project");
  try {
    await fs.mkdir(path.join(project, "files"), { recursive: true });
    await fs.writeFile(
      path.join(project, "files", "input.ccl"),
      "temperature = 10\r\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(project, "files", "alias.ccl"),
      "temperature = 10\r",
      "utf8",
    );
    await fs.writeFile(
      path.join(project, "files", "report.txt"),
      "maximum = 0\r\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(project, "files", "runner.cjs"),
      [
        'const fs = require("node:fs");',
        "const args = process.argv.slice(2);",
        "const input = args[args.indexOf('--input') + 1];",
        "const output = args[args.indexOf('--output') + 1];",
        "const materialIndex = args.indexOf('--material');",
        "const material = materialIndex >= 0 ? args[materialIndex + 1] : '';",
        'const text = fs.readFileSync(input, "utf8");',
        "const match = text.match(/temperature\\s*=\\s*([0-9.]+)/);",
        "const value = Number(match[1]) + 5;",
        'fs.writeFileSync(output, `maximum = ${value}\\r\\nmaterial = ${material}\\r\\n`, "utf8");',
      ].join("\n"),
      "utf8",
    );
    await writeJson(path.join(project, "project.json"), {
      schema: "program-studio-folder-project",
      schemaVersion: 5,
      name: "CLI 运行工作区测试",
      createdAt: "2026-11-09T00:00:00.000Z",
      updatedAt: "2026-11-09T00:00:00.000Z",
      launchFile: "launch.json",
      parameterFile: "parameters.json",
      outputFile: "outputs.json",
      modules: [
        {
          name: "input.ccl",
          files: ["files/input.ccl"],
          order: 1,
        },
        {
          name: "alias.ccl",
          files: ["files/alias.ccl"],
          order: 2,
        },
        {
          name: "report.txt",
          files: ["files/report.txt"],
          order: 3,
        },
        {
          name: "runner.cjs",
          files: ["files/runner.cjs"],
          order: 4,
        },
      ],
      files: [
        {
          path: "files/input.ccl",
          roles: ["input"],
        },
        {
          path: "files/alias.ccl",
          roles: ["input"],
        },
        {
          path: "files/report.txt",
          roles: ["output-reference"],
        },
        {
          path: "files/runner.cjs",
          roles: ["program-entry"],
        },
      ],
    });
    await writeJson(path.join(project, "launch.json"), {
      mode: "direct",
      program: process.execPath,
      arguments:
        "runner.cjs --input input.ccl --output report.txt --material @自由参数[In].材料",
      workingDirectory: "files",
    });
    await writeJson(path.join(project, "parameters.json"), {
      bindings: [
        {
          name: "温度",
          direction: "input",
          filePath: "files/input.ccl",
          locator: {
            kind: "pattern",
            pattern: "temperature\\s*=\\s*([0-9.]+)",
            flags: "",
            captureGroup: 1,
            occurrence: 0,
          },
          value: "10",
          parameterType: "number",
          defaultValue: "10",
          unit: "C",
          description: "",
        },
        {
          name: "温度副本",
          direction: "input",
          filePath: "files/alias.ccl",
          inputReference: "@input[In].温度",
          locator: {
            kind: "pattern",
            pattern: "temperature\\s*=\\s*([0-9.]+)",
            flags: "",
            captureGroup: 1,
            occurrence: 0,
          },
          value: "10",
          parameterType: "number",
          defaultValue: "10",
          unit: "C",
          description: "",
        },
        {
          scope: "free",
          name: "材料",
          direction: "input",
          value: "steel",
          parameterType: "text",
          defaultValue: "steel",
          unit: "",
          description: "",
        },
        {
          name: "最大值",
          direction: "output",
          filePath: "files/report.txt",
          outputName: "report",
          locator: {
            kind: "pattern",
            pattern: "maximum\\s*=\\s*([0-9.]+)",
            flags: "",
            captureGroup: 1,
            occurrence: 0,
          },
          value: "0",
          parameterType: "number",
          defaultValue: "0",
          unit: "",
          description: "",
        },
      ],
    });
    await writeJson(path.join(project, "outputs.json"), {
      outputs: [
        {
          name: "report",
          referenceFile: "files/report.txt",
          runtimePath: "files/report.txt",
          required: true,
          seed: "never",
          discovery: { type: "path" },
        },
      ],
    });

    const { stdout } = await runCommand(
      process.execPath,
      [
        path.join(process.cwd(), "scripts", "run-project.ts"),
        "--project",
        project,
        "--set",
        "input.ccl.温度=20",
        "--set",
        "自由参数.材料=aluminum",
      ],
      process.cwd(),
    );
    const report = JSON.parse(stdout);
    assert.equal(report.execution.inputs[0].effectiveValue, "20");
    assert.equal(report.execution.outputs[0].value, "25");
    assert.equal(report.project.runPath, path.join(project, "run"));
    assert.equal(
      await fs.readFile(
        path.join(project, "files", "input.ccl"),
        "utf8",
      ),
      "temperature = 10\r\n",
    );
    assert.equal(
      await fs.readFile(
        path.join(project, "files", "alias.ccl"),
        "utf8",
      ),
      "temperature = 10\r",
    );
    assert.equal(
      await fs.readFile(
        path.join(project, "files", "report.txt"),
        "utf8",
      ),
      "maximum = 0\r\n",
    );
    assert.equal(
      await fs.readFile(
        path.join(report.project.runPath, "files", "report.txt"),
        "utf8",
      ),
      "maximum = 25\r\nmaterial = aluminum\r\n",
    );
    assert.equal(
      await fs.readFile(
        path.join(report.project.runPath, "files", "alias.ccl"),
        "utf8",
      ),
      "temperature = 20\r",
    );
    assert.equal(
      await fs.readFile(
        path.join(report.project.runPath, "files", "input.ccl"),
        "utf8",
      ),
      "temperature = 20\r\n",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
