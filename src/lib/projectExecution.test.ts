import assert from "node:assert/strict";
import test from "node:test";
import {
  createBindingFromLocator,
  createLaunchFile,
  createLocatorForMode,
} from "./launcher.ts";
import {
  executeProjectWithOverrides,
  type ProjectExecutionAdapter,
  type ProjectExecutionSnapshot,
  type ProjectProgramRequest,
  type ProjectProgramResult,
} from "./projectExecution.ts";

const INPUT_PATH = "C:\\case\\input.txt";
const OUTPUT_PATH = "C:\\case\\output.txt";
const UNUSED_INPUT_PATH = "C:\\case\\unused.txt";

function buildSnapshot(): ProjectExecutionSnapshot {
  const inputFile = createLaunchFile(
    INPUT_PATH,
    "pressure = 10\n",
  );
  const outputFile = createLaunchFile(
    OUTPUT_PATH,
    "result = 20\n",
  );
  const input = {
    ...createBindingFromLocator(
      inputFile,
      createLocatorForMode("fixedLength", {
        startRowIndex: 1,
        startColumnIndex: 11,
        endRowIndex: 1,
        endColumnIndex: 13,
      }),
      "input",
      "pressure",
      "压力",
    ),
    parameterType: "number" as const,
  };
  const output = {
    ...createBindingFromLocator(
      outputFile,
      createLocatorForMode("fixedLength", {
        startRowIndex: 1,
        startColumnIndex: 9,
        endRowIndex: 1,
        endColumnIndex: 11,
      }),
      "output",
      "result",
      "结果",
    ),
    parameterType: "number" as const,
  };
  return {
    program: "C:\\solver.exe",
    arguments: "--pressure {{压力}}",
    workingDirectory: "C:\\case",
    files: [inputFile, outputFile],
    bindings: [input, output],
  };
}

class MemoryAdapter implements ProjectExecutionAdapter {
  readonly files = new Map<string, string>();
  readonly requests: ProjectProgramRequest[] = [];
  readonly writtenSnapshots: Array<Map<string, string>> = [];
  readonly readPaths: string[] = [];
  runResult: ProjectProgramResult = {
    status: "completed",
    exitCode: 0,
    signal: null,
    error: null,
    stdout: "",
    stderr: "",
    durationMs: 12,
  };
  onRun:
    | ((request: ProjectProgramRequest) => Promise<void> | void)
    | null = (request) => {
    this.files.set(
      OUTPUT_PATH,
      `result = ${request.args.at(-1) === "25" ? "45" : "20"}\n`,
    );
  };

  constructor(files: Array<[string, string]>) {
    for (const [filePath, content] of files) {
      this.files.set(filePath, content);
    }
  }

  async readFile(filePath: string) {
    this.readPaths.push(filePath);
    const content = this.files.get(filePath);
    return content === undefined
      ? null
      : { path: filePath, content };
  }

  async writeFiles(
    files: Array<{ path: string; content: string }>,
  ) {
    for (const file of files) this.files.set(file.path, file.content);
    this.writtenSnapshots.push(new Map(this.files));
    return files.map((file) => file.path);
  }

  async runProgram(request: ProjectProgramRequest) {
    this.requests.push(request);
    await this.onRun?.(request);
    return this.runResult;
  }
}

test("applies an input override by name and extracts outputs", async () => {
  const adapter = new MemoryAdapter([
    [INPUT_PATH, "pressure = 10\n"],
    [OUTPUT_PATH, "result = 20\n"],
  ]);
  const result = await executeProjectWithOverrides({
    snapshot: buildSnapshot(),
    overrides: [
      { target: "name", name: "压力", value: "25" },
    ],
    adapter,
  });

  assert.equal(adapter.requests.length, 1);
  assert.deepEqual(adapter.requests[0].args, [
    "--pressure",
    "25",
  ]);
  assert.equal(adapter.requests[0].cwd, "C:\\case");
  assert.equal(result.runtime.status, "completed");
  assert.equal(result.inputs[0].originalValue, "10");
  assert.equal(result.inputs[0].requestedValue, "25");
  assert.equal(result.inputs[0].effectiveValue, "25");
  assert.equal(result.outputs[0].value, "45");
  assert.equal("comparisons" in result, false);
  assert.equal("restoreErrors" in result, false);
  assert.equal(adapter.files.get(INPUT_PATH), "pressure = 25\n");
  assert.equal(adapter.files.get(OUTPUT_PATH), "result = 45\n");
});

test("applies an input override by binding ID", async () => {
  const snapshot = buildSnapshot();
  const adapter = new MemoryAdapter([
    [INPUT_PATH, "pressure = 10\n"],
    [OUTPUT_PATH, "result = 20\n"],
  ]);

  const result = await executeProjectWithOverrides({
    snapshot,
    overrides: [
      {
        target: "bindingId",
        bindingId: snapshot.bindings[0].id,
        value: "25",
      },
    ],
    adapter,
  });

  assert.equal(result.inputs[0].bindingId, snapshot.bindings[0].id);
  assert.equal(result.inputs[0].effectiveValue, "25");
  assert.equal(result.outputs[0].value, "45");
});

test("does not read or write input files outside the override targets", async () => {
  const snapshot = buildSnapshot();
  const unusedFile = createLaunchFile(
    UNUSED_INPUT_PATH,
    "unused = 7\n",
  );
  const unusedBinding = {
    ...createBindingFromLocator(
      unusedFile,
      createLocatorForMode("fixedLength", {
        startRowIndex: 1,
        startColumnIndex: 10,
        endRowIndex: 1,
        endColumnIndex: 11,
      }),
      "input",
      "unused",
      "未覆盖参数",
    ),
    parameterType: "number" as const,
  };
  snapshot.files.push(unusedFile);
  snapshot.bindings.splice(1, 0, unusedBinding);
  const adapter = new MemoryAdapter([
    [INPUT_PATH, "pressure = 10\n"],
    [UNUSED_INPUT_PATH, "unused = 7\n"],
    [OUTPUT_PATH, "result = 20\n"],
  ]);

  await executeProjectWithOverrides({
    snapshot,
    overrides: [
      { target: "name", name: "压力", value: "25" },
    ],
    adapter,
  });

  assert.equal(adapter.readPaths.includes(UNUSED_INPUT_PATH), false);
  assert.equal(adapter.files.get(UNUSED_INPUT_PATH), "unused = 7\n");
});

test("rejects unknown and output parameter overrides before writing files", async () => {
  const adapter = new MemoryAdapter([
    [INPUT_PATH, "pressure = 10\n"],
    [OUTPUT_PATH, "result = 20\n"],
  ]);

  await assert.rejects(
    () =>
      executeProjectWithOverrides({
        snapshot: buildSnapshot(),
        overrides: [
          { target: "name", name: "unknown", value: "1" },
        ],
        adapter,
      }),
    /未找到可覆盖的输入参数/,
  );
  assert.equal(adapter.requests.length, 0);

  await assert.rejects(
    () =>
      executeProjectWithOverrides({
        snapshot: buildSnapshot(),
        overrides: [
          { target: "name", name: "结果", value: "99" },
        ],
        adapter,
      }),
    /输出参数，不能覆盖/,
  );
  assert.equal(adapter.requests.length, 0);
});

test("rejects ambiguous names and duplicate binding selectors", async () => {
  const snapshot = buildSnapshot();
  snapshot.bindings.push({
    ...snapshot.bindings[0],
    id: "duplicate-name",
  });
  const adapter = new MemoryAdapter([
    [INPUT_PATH, "pressure = 10\n"],
    [OUTPUT_PATH, "result = 20\n"],
  ]);

  await assert.rejects(
    () =>
      executeProjectWithOverrides({
        snapshot,
        overrides: [
          { target: "name", name: "压力", value: "25" },
        ],
        adapter,
      }),
    /对应多个输入绑定/,
  );

  const stableSnapshot = buildSnapshot();
  await assert.rejects(
    () =>
      executeProjectWithOverrides({
        snapshot: stableSnapshot,
        overrides: [
          {
            target: "bindingId",
            bindingId: stableSnapshot.bindings[0].id,
            value: "25",
          },
          {
            target: "bindingId",
            bindingId: stableSnapshot.bindings[0].id,
            value: "30",
          },
        ],
        adapter,
      }),
    /重复覆盖/,
  );
  assert.equal(adapter.requests.length, 0);
});

test("returns extracted outputs even when the program fails", async () => {
  const adapter = new MemoryAdapter([
    [INPUT_PATH, "pressure = 10\n"],
    [OUTPUT_PATH, "result = 20\n"],
  ]);
  adapter.runResult = {
    status: "failed",
    exitCode: 2,
    signal: null,
    error: null,
    stdout: "partial",
    stderr: "failed",
    durationMs: 30,
  };
  adapter.onRun = () => {
    adapter.files.set(OUTPUT_PATH, "result = 33\n");
  };

  const result = await executeProjectWithOverrides({
    snapshot: buildSnapshot(),
    overrides: [
      { target: "name", name: "压力", value: "15" },
    ],
    adapter,
  });

  assert.equal(result.runtime.status, "failed");
  assert.equal(result.outputs[0].value, "33");
  assert.equal("comparisons" in result, false);
  assert.equal(adapter.files.get(INPUT_PATH), "pressure = 15\n");
  assert.equal(adapter.files.get(OUTPUT_PATH), "result = 33\n");
});

test("does not write any input when an input value is invalid", async () => {
  const adapter = new MemoryAdapter([
    [INPUT_PATH, "pressure = 10\n"],
    [OUTPUT_PATH, "result = 20\n"],
  ]);

  await assert.rejects(
    () =>
      executeProjectWithOverrides({
        snapshot: buildSnapshot(),
        overrides: [
          {
            target: "name",
            name: "压力",
            value: "not-a-number",
          },
        ],
        adapter,
      }),
    /有效数值/,
  );
  assert.equal(adapter.writtenSnapshots.length, 0);
  assert.equal(adapter.requests.length, 0);
});
