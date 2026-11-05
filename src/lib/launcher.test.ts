import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLaunchCommand,
  createBindingFromLocator,
  createBindingFromRowColumn,
  createBindingFromSelection,
  createLaunchFile,
  createLocatorForMode,
  extractOutputBindings,
  parseCommandArguments,
  resolveLaunchBinding,
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
    `binding-${direction}-${occurrence}`,
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
    "global-max",
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
    "temperature-unit",
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
    "json-max",
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
    "json-material",
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
    "xml-maximum",
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
    "field",
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
    "pattern",
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
      binding.locator,
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
    id: "ambiguous",
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
    '--input "case one.ccl" --mode {{mode}}',
  );
  const command = buildLaunchCommand(
    "C:\\Tools\\solver.exe",
    '--input "case one.ccl" --mode {{mode}}',
    [binding],
  );

  assert.deepEqual(args, [
    "--input",
    "case one.ccl",
    "--mode",
    "{{mode}}",
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
