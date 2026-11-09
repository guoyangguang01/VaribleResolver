import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLaunchCommand,
  createAutoPositionLocator,
  createBindingFromLocator,
  createBindingFromRowColumn,
  createBindingFromSelection,
  createLaunchFile,
  createLocatorForMode,
  extractOutputBindings,
  inferParameterType,
  interpolateArguments,
  parseCommandArguments,
  parameterKey,
  resolveInputReferences,
  resolveLaunchBinding,
  tokenizeSpecialCharacters,
  validateParameterValue,
  writeInputBindings,
  type LaunchBinding,
} from "./launcher.ts";

function file(name: string, content: string) {
  return createLaunchFile(name, content);
}

function selectedBinding(
  sourceFile: ReturnType<typeof file>,
  selected: string,
  direction: "input" | "output",
  occurrence = 0,
) {
  let cursor = 0;
  let start = -1;
  for (let index = 0; index <= occurrence; index += 1) {
    start = sourceFile.content.indexOf(selected, cursor);
    if (start < 0) throw new Error(`Selection not found: ${selected}`);
    cursor = start + selected.length;
  }
  return createBindingFromSelection(
    sourceFile,
    { start, end: start + selected.length },
    direction,
  );
}

test("creates an automatic position binding and writes the selected range", () => {
  const source = `LIBRARY:
  MATERIAL: Water
    PROPERTIES:
      Specific Heat Capacity = 4181.7 [J kg^-1 K^-1]
    END
  END
END
`;
  const sourceFile = file("CFX1.ccl", source);
  const binding = {
    ...selectedBinding(sourceFile, "4181.7", "input"),
    value: "4500",
  };
  const result = writeInputBindings(
    sourceFile.content,
    [binding],
  );

  assert.deepEqual(result.errors, []);
  assert.equal(binding.locator.kind, "autoPosition");
  assert.equal(binding.locator.startRowIndex, 4);
  assert.match(
    result.source,
    /Specific Heat Capacity = 4500 \[J kg\^-1 K\^-1\]/,
  );
  assert.equal(
    resolveLaunchBinding(
      result.source,
      result.bindings[0].locator,
    ).value,
    "4500",
  );
});

test("tokenizes a line only by whitespace, punctuation, and symbols", () => {
  assert.deepEqual(
    tokenizeSpecialCharacters("期限30日，金额10000元。"),
    [
      { index: 0, startCol: 0, endCol: 5 },
      { index: 1, startCol: 5, endCol: 6 },
      { index: 2, startCol: 6, endCol: 14 },
      { index: 3, startCol: 14, endCol: 15 },
    ],
  );
});

test("keeps an automatic token selection accurate when its value grows", () => {
  const sourceFile = file("term.txt", "期限30日，金额10000元。");
  const binding = selectedBinding(sourceFile, "30", "output");
  assert.equal(binding.locator.kind, "autoPosition");
  if (binding.locator.kind !== "autoPosition") {
    assert.fail("expected autoPosition locator");
  }
  assert.deepEqual(binding.locator.tokenRange, {
    tokenCount: 4,
    startTokenIndex: 0,
    startOffsetFromTokenStart: 2,
    endTokenIndex: 0,
    endOffsetFromTokenEnd: 1,
  });

  const updatedFile = {
    ...sourceFile,
    content: "期限300日，金额10000元。",
  };
  const [output] = extractOutputBindings([updatedFile], [binding]);
  assert.equal(output.value, "300");
  assert.equal(output.error, null);
});

test("recomputes multiple token-relative parameters after earlier values change", () => {
  const sourceFile = file("terms.txt", "期限30日，金额10000元。");
  const term = selectedBinding(sourceFile, "30", "output");
  const amount = selectedBinding(sourceFile, "10000", "output");
  const updatedFile = {
    ...sourceFile,
    content: "期限300日，金额20000元。",
  };
  const outputs = extractOutputBindings([updatedFile], [term, amount]);

  assert.deepEqual(
    outputs.map((output) => output.value),
    ["300", "20000"],
  );
  assert.deepEqual(
    outputs.map((output) => output.error),
    [null, null],
  );
});

test("rejects a token-relative automatic locator after the token count changes", () => {
  const sourceFile = file("terms.txt", "期限30日，金额10000元。");
  const binding = selectedBinding(sourceFile, "30", "output");
  const updatedFile = {
    ...sourceFile,
    content: "期限3-0日，金额10000元。",
  };
  const [output] = extractOutputBindings([updatedFile], [binding]);

  assert.equal(output.value, null);
  assert.match(output.error ?? "", /Token 数量发生变化/);
});

test("keeps cross-line automatic selections on the legacy fixed range", () => {
  const sourceFile = file("multi.txt", "first\nsecond");
  const locator = createAutoPositionLocator(sourceFile, {
    start: sourceFile.content.indexOf("first"),
    end: sourceFile.content.indexOf("second") + "second".length,
  });

  assert.equal(locator.tokenRange, undefined);
  assert.equal(
    resolveLaunchBinding(sourceFile.content, locator).value,
    "first\nsecond",
  );
});

test("uses the full path as file identity and derives the display name", () => {
  const sourceFile = createLaunchFile(
    "C:\\Cases\\fa1\\GSP\\CFX1.ccl",
    "Option = Value",
  );

  assert.equal(sourceFile.path, "C:\\Cases\\fa1\\GSP\\CFX1.ccl");
  assert.equal(sourceFile.name, "CFX1.ccl");
  assert.equal(sourceFile.flavor, "ccl");
});

test("writes and extracts values through fa1-style row and column positions", () => {
  const sourceFile = file(
    "C:\\Cases\\fa1\\Stress_Envelope_Summary.txt",
    [
      "Result\tMax\tMin\tUnit",
      "Equivalent Stress\t3.31996114e+08\t3.80313897e+01\tPa",
    ].join("\n"),
  );
  const maximum = createBindingFromRowColumn(
    sourceFile,
    {
      startRowIndex: 2,
      startColumnIndex: 18,
      endRowIndex: 2,
      endColumnIndex: 32,
    },
    "output",
    "全局最大应力",
  );
  const updatedFile = {
    ...sourceFile,
    content:
      "Result\tMax\tMin\tUnit\nEquivalent Stress\t4.20000000e+08\t3.80313897e+01\tPa",
  };
  const [output] = extractOutputBindings([updatedFile], [maximum]);

  assert.equal(maximum.locator.kind, "rowColumn");
  assert.equal(output.value, "4.20000000e+08");
  assert.equal(output.error, null);
});

test("locates unit parameters through their own row and column range", () => {
  const source = "          Total Temperature = 539.15 [K]";
  const sourceFile = file("thermal.ccl", source);
  const unitColumn = source.indexOf("K");
  const unitBinding = createBindingFromRowColumn(
    sourceFile,
    {
      startRowIndex: 1,
      startColumnIndex: unitColumn,
      endRowIndex: 1,
      endColumnIndex: unitColumn + 1,
    },
    "input",
    "入口温度单位",
  );
  const result = writeInputBindings(
    sourceFile.content,
    [{ ...unitBinding, value: "C" }],
  );

  assert.equal(unitBinding.locator.kind, "rowColumn");
  assert.equal(unitBinding.value, "K");
  assert.equal(
    result.source,
    "          Total Temperature = 539.15 [C]",
  );
});

test("extracts and writes a JSON path value without disturbing the document", () => {
  const sourceFile = file(
    "result.json",
    '{"status":"ok","results":[{"maximum":12.5,"label":"stress"}]}',
  );
  const binding = createBindingFromLocator(
    sourceFile,
    createLocatorForMode("jsonPath", {
      jsonPath: "$.results[0].maximum",
    }),
    "input",
    "maximum",
  );
  const result = writeInputBindings(
    sourceFile.content,
    [{ ...binding, value: "18.75" }],
  );

  assert.equal(result.errors.length, 0);
  assert.equal(
    result.source,
    '{"status":"ok","results":[{"maximum":18.75,"label":"stress"}]}',
  );
  assert.equal(
    resolveLaunchBinding(
      result.source,
      binding.locator,
    ).value,
    "18.75",
  );
});

test("writes a JSON string path as a quoted JSON string", () => {
  const sourceFile = file("result.json", '{"material":"material1"}');
  const binding = createBindingFromLocator(
    sourceFile,
    createLocatorForMode("jsonPath", {
      jsonPath: "$.material",
    }),
    "input",
    "material",
  );
  const result = writeInputBindings(
    sourceFile.content,
    [{ ...binding, value: 'steel "A"' }],
  );

  assert.equal(result.source, '{"material":"steel \\"A\\""}');
});

test("extracts and writes XML attributes and text by XML path", () => {
  const sourceFile = file(
    "result.xml",
    '<root><result maximum="12.5">OK</result></root>',
  );
  const maximum = createBindingFromLocator(
    sourceFile,
    createLocatorForMode("xmlPath", {
      xmlPath: "/root/result[1]/@maximum",
    }),
    "input",
    "maximum",
  );
  const written = writeInputBindings(
    sourceFile.content,
    [{ ...maximum, value: "20" }],
  );

  assert.equal(
    written.source,
    '<root><result maximum="20">OK</result></root>',
  );
  assert.equal(
    resolveLaunchBinding(
      written.source,
      maximum.locator,
    ).value,
    "20",
  );
});

test("supports delimiter, marker, line, and regex locator modes", () => {
  const sourceFile = file(
    "result.log",
    [
      "name,value,unit",
      "stress,12.5,Pa",
      "BEGIN",
      "output: 18.25",
      "END",
    ].join("\n"),
  );
  const field = createBindingFromLocator(
    sourceFile,
    createLocatorForMode("delimited", {
      startRowIndex: 2,
      separator: ",",
      fieldIndex: 1,
    }),
    "input",
    "value",
  );
  const marker = createBindingFromLocator(
    sourceFile,
    createLocatorForMode("indefiniteLine", {
      startMarker: "BEGIN",
      endMarker: "END",
    }),
    "output",
    "marker",
  );
  const wholeLine = createLocatorForMode("wholeLine", {
    startRowIndex: 1,
  });
  const multiLine = createLocatorForMode("multiLine", {
    startRowIndex: 1,
    endRowIndex: 2,
  });
  const pattern = createBindingFromLocator(
    sourceFile,
    createLocatorForMode("pattern", {
      pattern: "output:\\s*([\\d.]+)",
      captureGroup: 1,
    }),
    "output",
    "pattern value",
  );

  assert.equal(field.value, "12.5");
  assert.equal(
    resolveLaunchBinding(
      sourceFile.content,
      wholeLine,
    ).value,
    "name,value,unit",
  );
  assert.equal(
    resolveLaunchBinding(
      sourceFile.content,
      multiLine,
    ).value,
    "name,value,unit\nstress,12.5,Pa",
  );
  assert.equal(marker.value, "output: 18.25");
  assert.equal(pattern.value, "18.25");
});

test("writes the exact selected coordinate range without text escaping", () => {
  const source = `body.Material = "material1"`;
  const sourceFile = file("setup.py", source);
  const binding = {
    ...selectedBinding(sourceFile, "material1", "input"),
    value: 'steel "A"',
  };
  const result = writeInputBindings(
    sourceFile.content,
    [binding],
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.source, 'body.Material = "steel "A""');
  assert.equal(
    resolveLaunchBinding(
      result.source,
      result.bindings[0].locator,
    ).value,
    'steel "A"',
  );
});

test("writes a multiline replacement and updates its coordinate range", () => {
  const sourceFile = file("setup.py", 'body.Material = "material1"');
  const binding = {
    ...selectedBinding(sourceFile, "material1", "input"),
    value: "line one\nline two",
  };
  const written = writeInputBindings(
    sourceFile.content,
    [binding],
  );
  assert.equal(written.errors.length, 0);
  assert.equal(written.source, 'body.Material = "line one\nline two"');
  assert.equal(
    resolveLaunchBinding(
      written.source,
      written.bindings[0].locator,
    ).value,
    "line one\nline two",
  );
});

test("applies multiple input replacements from the end of the source", () => {
  const source = [
    "pressure = 10 [Pa]",
    "temperature = 300 [K]",
    "pressure = 20 [Pa]",
  ].join("\n");
  const sourceFile = file("case.ccl", source);
  const firstPressure = {
    ...selectedBinding(sourceFile, "10", "input"),
    value: "15",
  };
  const secondPressure = {
    ...selectedBinding(sourceFile, "20", "input"),
    value: "25",
  };
  const result = writeInputBindings(
    sourceFile.content,
    [firstPressure, secondPressure],
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.source.split("\n")[0], "pressure = 15 [Pa]");
  assert.equal(result.source.split("\n")[2], "pressure = 25 [Pa]");
});

test("extracts an output value from its fixed coordinate range", () => {
  const sourceFile = file("result.txt", "RESULT: 12.5\nSTATUS: OK");
  const binding = selectedBinding(sourceFile, "12.5", "output");
  const updatedFile = {
    ...sourceFile,
    content: "RESULT: 99.5\nSTATUS: OK",
  };
  const [output] = extractOutputBindings([updatedFile], [binding]);

  assert.equal(output.value, "99.5");
  assert.equal(output.error, null);
  assert.equal(
    updatedFile.content.slice(output.range!.start, output.range!.end),
    "99.5",
  );
});

test("supports manual and referenced free output parameters", () => {
  const sourceFile = file("result.txt", "maximum = 12.5\n");
  const bound = createBindingFromLocator(
    sourceFile,
    createLocatorForMode("pattern", {
      pattern: "maximum\\s*=\\s*([0-9.]+)",
      captureGroup: 1,
    }),
    "output",
    "最大值",
  );
  const referenced: LaunchBinding = {
    scope: "free",
    name: "引用最大值",
    direction: "output",
    outputReference: "@result[Out].最大值",
    value: "",
    parameterType: "number",
    defaultValue: "",
    unit: "",
    description: "",
  };
  const manual: LaunchBinding = {
    scope: "free",
    name: "手动结果",
    direction: "output",
    value: "fallback",
    parameterType: "text",
    defaultValue: "",
    unit: "",
    description: "",
  };

  const outputs = extractOutputBindings(
    [sourceFile],
    [bound, referenced, manual],
  );
  assert.equal(outputs[0].value, "12.5");
  assert.equal(outputs[1].value, "12.5");
  assert.equal(outputs[1].error, null);
  assert.equal(outputs[2].value, "fallback");
});

test("keeps the selected row when repeated text appears on other lines", () => {
  const sourceFile = file(
    "repeated.log",
    "RUN: first\nRUN: second\nRUN: third\n",
  );
  const binding = selectedBinding(sourceFile, "second", "output");
  const updatedFile = {
    ...sourceFile,
    content: "RUN: alpha\nRUN: beta\nRUN: gamma\n",
  };
  const [output] = extractOutputBindings([updatedFile], [binding]);

  assert.equal(output.value, "beta");
  assert.equal(output.error, null);
});

test("reports an invalid row instead of guessing another location", () => {
  const sourceFile = file(
    "ambiguous.txt",
    "VALUE = 1\nVALUE = 2\n",
  );
  const binding: LaunchBinding = {
    name: "value",
    direction: "output",
    filePath: sourceFile.path,
    locator: {
      kind: "rowColumn",
      startRowIndex: 8,
      startColumnIndex: 0,
      endRowIndex: 8,
      endColumnIndex: 1,
    },
    value: "1",
    parameterType: "number",
    defaultValue: "1",
    unit: "",
    description: "",
  };
  const [output] = extractOutputBindings([sourceFile], [binding]);

  assert.equal(output.value, null);
  assert.match(output.error ?? "", /行不存在/);
});

test("parses quoted arguments, interpolates parameters, and builds a command", () => {
  const sourceFile = file("config.ccl", "mode = fast");
  const binding = {
    ...selectedBinding(sourceFile, "fast", "input"),
    name: "mode",
    value: "careful mode",
  };
  const args = parseCommandArguments(
    '--input "case one.ccl" --mode @config[In].mode',
  );
  const command = buildLaunchCommand(
    "C:\\Tools\\solver.exe",
    '--input "case one.ccl" --mode @config[In].mode',
    [binding],
  );

  assert.deepEqual(args, [
    "--input",
    "case one.ccl",
    "--mode",
    "@config[In].mode",
  ]);
  assert.equal(
    command,
    'C:\\Tools\\solver.exe --input "case one.ccl" --mode "careful mode"',
  );
});

test("reports an unclosed argument quote", () => {
  assert.throws(
    () => parseCommandArguments('--name "unfinished'),
    /未闭合/,
  );
});

test("rejects the legacy brace syntax and unresolved @ references", () => {
  const sourceFile = file("config.ccl", "mode = fast");
  const binding = {
    ...selectedBinding(sourceFile, "fast", "input"),
    name: "mode",
  };
  assert.throws(
    () => interpolateArguments(["{{mode}}"], [binding]),
    /只支持 @文件名\[In\]\.参数名/,
  );
  assert.throws(
    () => interpolateArguments(["@missing[In].mode"], [binding]),
    /未找到输入参数/,
  );
});

test("resolves input references and interpolates @ parameter aliases", () => {
  const primaryFile = file("primary.txt", "temperature = 550\n");
  const aliasFile = file("alias.txt", "temperature = 550\n");
  const primary = {
    ...selectedBinding(primaryFile, "550", "input"),
    name: "入口温度",
    value: "600",
  };
  const alias = {
    ...selectedBinding(aliasFile, "550", "input"),
    name: "副本温度",
    value: "0",
    inputReference: "@primary[In].入口温度",
  };

  const resolution = resolveInputReferences([primary, alias]);
  assert.equal(resolution.errors.size, 0);
  assert.equal(
    resolution.roots.get(parameterKey(alias)) &&
      parameterKey(resolution.roots.get(parameterKey(alias))!),
    parameterKey(primary),
  );
  assert.deepEqual(
    parseCommandArguments(
      "--primary @primary[In].入口温度 --alias=@alias.txt[In].副本温度",
    ).map((argument) =>
      interpolateArguments([argument], [primary, alias])[0],
    ),
    ["--primary", "600", "--alias=600"],
  );
  assert.deepEqual(
    interpolateArguments(["@id:alias"], [primary, alias]),
    ["@id:alias"],
  );
});

test("reports input reference cycles and type mismatches", () => {
  const firstFile = file("first.txt", "a = 1\n");
  const secondFile = file("second.txt", "b = 1\n");
  const first = {
    ...selectedBinding(firstFile, "1", "input"),
    name: "A",
    inputReference: "@second[In].B",
  };
  const second = {
    ...selectedBinding(secondFile, "1", "input"),
    name: "B",
    inputReference: "@first[In].A",
  };
  const cycle = resolveInputReferences([first, second]);
  assert.match([...cycle.errors.values()][0] ?? "", /循环引用/);

  const boolAlias = {
    ...selectedBinding(secondFile, "1", "input"),
    name: "布尔副本",
    parameterType: "boolean" as const,
    inputReference: "@first[In].A",
  };
  const mismatch = resolveInputReferences([
    {
      ...first,
      inputReference: undefined,
    },
    boolAlias,
  ]);
  assert.match([...mismatch.errors.values()][0] ?? "", /类型不一致/);
});

test("interpolates a free parameter without a file binding", () => {
  const free: LaunchBinding = {
    scope: "free",
    name: "材料",
    direction: "input",
    value: "steel",
    parameterType: "text",
    defaultValue: "steel",
    unit: "",
    description: "",
  };
  assert.deepEqual(
    interpolateArguments(["--material", "@自由参数[In].材料"], [free]),
    ["--material", "steel"],
  );
});

test("infers and validates parameter types before writing inputs", () => {
  assert.equal(inferParameterType("12.5e-3"), "number");
  assert.equal(inferParameterType("False"), "boolean");
  assert.equal(inferParameterType("C:\\Cases\\input.txt"), "text");
  assert.equal(validateParameterValue("number", "1.25e+08"), null);
  assert.match(
    validateParameterValue("number", "not a number") ?? "",
    /有效数值/,
  );
  assert.match(
    validateParameterValue("boolean", "yes") ?? "",
    /true 或 false/,
  );

  const sourceFile = file("typed.txt", "VALUE = 12.5\n");
  const binding = {
    ...selectedBinding(sourceFile, "12.5", "input"),
    value: "invalid",
  };
  const result = writeInputBindings(sourceFile.content, [binding]);

  assert.equal(result.writtenParameterKeys.length, 0);
  assert.match(result.errors[0]?.message ?? "", /有效数值/);
});

test("validates the four base parameter types", () => {
  assert.equal(validateParameterValue("number", "12.5"), null);
  assert.equal(validateParameterValue("boolean", "TRUE"), null);
  assert.equal(validateParameterValue("path", "inputs/case.ccl"), null);
  assert.equal(validateParameterValue("text", "any text"), null);
  assert.match(validateParameterValue("path", "") ?? "", /不能为空/);
  const sourceFile = file("boolean.txt", "enabled = true\n");
  const binding = {
    ...selectedBinding(sourceFile, "true", "input"),
    value: "true",
    parameterType: "boolean" as const,
  };
  const result = writeInputBindings(sourceFile.content, [binding]);
  assert.equal(result.source, "enabled = true\n");
  assert.equal(result.errors.length, 0);
});
