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
      "结果",
    ),
    parameterType: "number" as const,
  };
  return {
    program: "C:\\solver.exe",
    arguments: "--pressure @input[In].压力",
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

test("applies an input override by file and parameter name", async () => {
  const adapter = new MemoryAdapter([
    [INPUT_PATH, "pressure = 10\n"],
    [OUTPUT_PATH, "result = 20\n"],
  ]);
  const result = await executeProjectWithOverrides({
    snapshot: buildSnapshot(),
    overrides: [
      {
        fileName: "input.txt",
        parameterName: "压力",
        value: "25",
      },
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

test("preserves each input file's line ending when writing overrides", async () => {
  for (const lineEnding of ["\n", "\r\n", "\r"] as const) {
    const adapter = new MemoryAdapter([
      [INPUT_PATH, `pressure = 10${lineEnding}`],
      [OUTPUT_PATH, `result = 20${lineEnding}`],
    ]);
    adapter.onRun = (request) => {
      const value = request.args.at(-1) === "25" ? "45" : "20";
      adapter.files.set(OUTPUT_PATH, `result = ${value}${lineEnding}`);
    };

    const result = await executeProjectWithOverrides({
      snapshot: buildSnapshot(),
      overrides: [
        {
          fileName: "input.txt",
          parameterName: "压力",
          value: "25",
        },
      ],
      adapter,
    });

    assert.equal(
      adapter.files.get(INPUT_PATH),
      `pressure = 25${lineEnding}`,
    );
    assert.equal(
      adapter.files.get(OUTPUT_PATH),
      `result = 45${lineEnding}`,
    );
    assert.equal(result.outputs[0].value, "45");
  }
});

test("matches an input override by the file stem", async () => {
  const snapshot = buildSnapshot();
  const adapter = new MemoryAdapter([
    [INPUT_PATH, "pressure = 10\n"],
    [OUTPUT_PATH, "result = 20\n"],
  ]);

  const result = await executeProjectWithOverrides({
    snapshot,
    overrides: [
      {
        fileName: "input",
        parameterName: "压力",
        value: "25",
      },
    ],
    adapter,
  });

  assert.equal(result.inputs[0].parameterKey, "input.txt.压力");
  assert.equal(result.inputs[0].effectiveValue, "25");
  assert.equal(result.outputs[0].value, "45");
});

test("writes a primary input value to every referencing file", async () => {
  const snapshot = buildSnapshot();
  const aliasFile = createLaunchFile(
    "C:\\case\\alias.txt",
    "pressure = 10\n",
  );
  const alias = {
    ...snapshot.bindings[0],
    name: "副本压力",
    filePath: aliasFile.path,
    inputReference: "@input[In].压力",
  };
  snapshot.files.push(aliasFile);
  snapshot.bindings.push(alias);
  const adapter = new MemoryAdapter([
    [INPUT_PATH, "pressure = 10\n"],
    [aliasFile.path, "pressure = 10\n"],
    [OUTPUT_PATH, "result = 20\n"],
  ]);

  const result = await executeProjectWithOverrides({
    snapshot,
    overrides: [
      {
        fileName: "input.txt",
        parameterName: "压力",
        value: "25",
      },
    ],
    adapter,
  });

  assert.equal(adapter.files.get(INPUT_PATH), "pressure = 25\n");
  assert.equal(adapter.files.get(aliasFile.path), "pressure = 25\n");
  assert.equal(result.inputs.length, 2);
  assert.deepEqual(
    result.inputs.map((input) => input.effectiveValue),
    ["25", "25"],
  );
});

test("rejects assigning a referencing input directly", async () => {
  const snapshot = buildSnapshot();
  const mainFile = createLaunchFile(
    "C:\\case\\main.txt",
    "pressure = 10\n",
  );
  const primary = {
    ...snapshot.bindings[0],
    name: "主压力",
    filePath: mainFile.path,
  };
  const alias = {
    ...snapshot.bindings[0],
    inputReference: "@main[In].主压力",
  };
  snapshot.files.push(mainFile);
  snapshot.bindings = [primary, alias, snapshot.bindings[1]];
  const adapter = new MemoryAdapter([
    [mainFile.path, "pressure = 10\n"],
    [INPUT_PATH, "pressure = 10\n"],
    [OUTPUT_PATH, "result = 20\n"],
  ]);

  await assert.rejects(
    () =>
      executeProjectWithOverrides({
        snapshot,
        overrides: [
          {
            fileName: "input.txt",
            parameterName: "压力",
            value: "25",
          },
        ],
        adapter,
      }),
    /请改为覆盖主参数/,
  );
  assert.equal(adapter.requests.length, 0);
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
      {
        fileName: "input.txt",
        parameterName: "压力",
        value: "25",
      },
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
          {
            fileName: "input.txt",
            parameterName: "unknown",
            value: "1",
          },
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
          {
            fileName: "output.txt",
            parameterName: "结果",
            value: "99",
          },
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
          {
            fileName: "input.txt",
            parameterName: "压力",
            value: "25",
          },
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
            fileName: "input.txt",
            parameterName: "压力",
            value: "25",
          },
          {
            fileName: "input.txt",
            parameterName: "压力",
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
      {
        fileName: "input.txt",
        parameterName: "压力",
        value: "15",
      },
    ],
    adapter,
  });

  assert.equal(result.runtime.status, "failed");
  assert.equal(result.outputs[0].value, "33");
  assert.equal("comparisons" in result, false);
  assert.equal(adapter.files.get(INPUT_PATH), "pressure = 15\n");
  assert.equal(adapter.files.get(OUTPUT_PATH), "result = 33\n");
});

test("passes a free input parameter without touching any input file", async () => {
  const snapshot = buildSnapshot();
  snapshot.arguments =
    "--material @自由参数[In].材料 --pressure @input[In].压力";
  snapshot.bindings.unshift({
    scope: "free",
    name: "材料",
    direction: "input",
    value: "steel",
    parameterType: "text",
    defaultValue: "steel",
    unit: "",
    description: "",
  });
  const adapter = new MemoryAdapter([
    [INPUT_PATH, "pressure = 10\n"],
    [OUTPUT_PATH, "result = 20\n"],
  ]);

  const result = await executeProjectWithOverrides({
    snapshot,
    overrides: [
      {
        fileName: "自由参数",
        parameterName: "材料",
        value: "aluminum",
      },
    ],
    adapter,
  });

  assert.deepEqual(adapter.requests[0].args, [
    "--material",
    "aluminum",
    "--pressure",
    "10",
  ]);
  assert.equal(adapter.readPaths.includes(INPUT_PATH), false);
  assert.equal(result.inputs[0].parameterKey, "自由参数.材料");
  assert.equal(result.inputs[0].filePath, undefined);
  assert.equal(result.inputs[0].effectiveValue, "aluminum");
});

test("returns referenced and manual free output values", async () => {
  const snapshot = buildSnapshot();
  snapshot.bindings.push(
    {
      scope: "free",
      name: "引用结果",
      direction: "output",
      outputReference: "@output[Out].结果",
      value: "",
      parameterType: "number",
      defaultValue: "",
      unit: "",
      description: "",
    },
    {
      scope: "free",
      name: "手动结果",
      direction: "output",
      value: "manual",
      parameterType: "text",
      defaultValue: "",
      unit: "",
      description: "",
    },
  );
  const adapter = new MemoryAdapter([
    [INPUT_PATH, "pressure = 10\n"],
    [OUTPUT_PATH, "result = 20\n"],
  ]);

  const result = await executeProjectWithOverrides({
    snapshot,
    overrides: [
      {
        fileName: "input.txt",
        parameterName: "压力",
        value: "25",
      },
    ],
    adapter,
  });

  assert.equal(
    result.outputs.find(
      (output) => output.parameterKey === "自由参数.引用结果",
    )?.value,
    "45",
  );
  assert.equal(
    result.outputs.find(
      (output) => output.parameterKey === "自由参数.手动结果",
    )?.value,
    "manual",
  );
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
            fileName: "input.txt",
            parameterName: "压力",
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
