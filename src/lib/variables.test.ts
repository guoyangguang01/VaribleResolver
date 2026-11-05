import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  detectSourceFlavor,
  findVariableAt,
  findVariableTarget,
  normalizeSourceText,
  parseVariables,
  selectVariableOccurrences,
  sourceFlavorFromFilename,
} from "./variables.ts";

const CCL_SAMPLE = `# State file
LIBRARY:
  MATERIAL: Water
    PROPERTIES:
      SPECIFIC HEAT CAPACITY:
        Option = Value
        Specific Heat Capacity = 4181.7 [J kg^-1 K^-1]
      END
    END
  END
`;

test("parses CCL variables, values, units, and block paths", () => {
  const target = findVariableTarget(
    CCL_SAMPLE,
    CCL_SAMPLE.indexOf("4181.7"),
  );

  assert.ok(target);
  assert.equal(target.variableName, "Specific Heat Capacity");
  assert.equal(target.value, "4181.7");
  assert.equal(target.unit, "[J kg^-1 K^-1]");
  assert.equal(target.line, 7);
  assert.equal(target.material, "Water");
  assert.equal(target.section, "SPECIFIC HEAT CAPACITY");
  assert.equal(
    CCL_SAMPLE.slice(target.nameRange.start, target.nameRange.end),
    "Specific Heat Capacity",
  );
  assert.equal(
    CCL_SAMPLE.slice(target.valueRange.start, target.valueRange.end),
    "4181.7",
  );
  assert.deepEqual(target.path, [
    "LIBRARY",
    "MATERIAL: Water",
    "PROPERTIES",
    "SPECIFIC HEAT CAPACITY",
  ]);
});

test("normalizes CRLF so textarea selections and parsed ranges align", () => {
  const crlf = CCL_SAMPLE.replace(/\n/g, "\r\n");
  const source = normalizeSourceText(crlf);
  assert.equal(source.includes("\r"), false);

  const target = findVariableTarget(
    source,
    source.indexOf("4181.7"),
  );
  assert.ok(target);
  assert.equal(
    source.slice(target.valueRange.start, target.valueRange.end),
    "4181.7",
  );
});

test("parses Python assignments while ignoring comparisons and keyword arguments", () => {
  const source = `def build():
    for body in bodies:
        if body.Name == target:
            body.Material = "material1"
SetScriptVersion(Version="19.5")
`;
  const variables = parseVariables(source);
  const target = findVariableTarget(
    source,
    source.indexOf("body.Material"),
  );

  assert.equal(variables.length, 1);
  assert.ok(target);
  assert.equal(target.variableName, "body.Material");
  assert.equal(target.value, "material1");
  assert.deepEqual(target.path, [
    "def build()",
    "for body in bodies",
    "if body.Name == target",
  ]);
});

test("keeps multi-line function arguments in their call context", () => {
  const source = `ccl_out = r"model.ccl"
with open(ccl_out, "w") as f:
    f.write("data")
matlProp1.SetData(
    Index=-1,
    Values=[["7930 [kg m^-3]"]],
)
`;
  const target = findVariableTarget(
    source,
    source.indexOf("7930 [kg m^-3]"),
  );

  assert.ok(target);
  assert.equal(target.variableName, "Values");
  assert.equal(target.value, '[["7930 [kg m^-3]"]]');
  assert.deepEqual(target.path, ["matlProp1.SetData(...)"]);
});

test("distinguishes repeated Python blocks with referenced setup values", () => {
  const source = `target_body_name = "fati"
for body in bodies:
    if body.Name == target_body_name:
        body.Material = "material1"

target_body_name = "fagai"
for body in bodies:
    if body.Name == target_body_name:
        body.Material = "material2"
`;
  const first = findVariableTarget(
    source,
    source.indexOf('body.Material = "material1"'),
  );
  const second = findVariableTarget(
    source,
    source.indexOf('body.Material = "material2"'),
  );

  assert.equal(first?.path[0], "target_body_name = fati");
  assert.equal(second?.path[0], "target_body_name = fagai");
  assert.equal(first?.contextValues[0].value, "fati");
  assert.equal(second?.contextValues[0].value, "fagai");
  assert.notDeepEqual(first?.path, second?.path);
});

test("locates the content of a Python string literal without its syntax", () => {
  const value = "J:\\ST\\AW\\fa\\fa1\\GSP\\CFX_setup_0.ccl";
  const source = `dsScriptFileCFX2 = r"${value}"`;
  const target = findVariableTarget(source, source.indexOf('r"'));

  assert.ok(target);
  assert.equal(target.variableName, "dsScriptFileCFX2");
  assert.equal(target.rawValue, `r"${value}"`);
  assert.equal(target.valuePrefix, "r");
  assert.equal(target.valueQuote, '"');
  assert.equal(target.value, value);
  assert.equal(source.slice(target.valueRange.start, target.valueRange.end), value);
});

test("associates a user selection with the matching parsed variable", () => {
  const source = `target_body_name = "fati"
target_body_name = "fagai"
target_body_name = "fagan"
`;
  const variables = parseVariables(source);
  const selected = findVariableAt(variables, source.indexOf('"fagai"'));
  assert.ok(selected);

  const occurrences = selectVariableOccurrences(variables, selected);
  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].value, "fagai");
});

test("does not switch parsers for embedded text in another file format", () => {
  const source = `ccl_path = "model.ccl"
ccl_content = """LIBRARY:
  MATERIAL: Water
    PROPERTIES:
      SPECIFIC HEAT CAPACITY:
        Specific Heat Capacity = 4181.7 [J kg^-1 K^-1]
    END
  END
"""
`;
  const variables = parseVariables(source);
  const target = variables.find(
    (variable) => variable.variableName === "Specific Heat Capacity",
  );

  assert.equal(target, undefined);
  assert.ok(
    variables.some((variable) => variable.variableName === "ccl_content"),
  );
});

test("parses CSE blocks and detects source flavors", () => {
  const source = `COMMAND FILE:
  CFX Post Version = 19.5
END
PLANE: Plane 1
  Bound Radius = 0.5 [m]
END
`;
  const target = findVariableTarget(
    source,
    source.indexOf("Bound Radius"),
  );
  assert.ok(target);
  assert.equal(target.unit, "[m]");
  assert.deepEqual(target.path, ["PLANE: Plane 1"]);

  assert.equal(sourceFlavorFromFilename("CFX1.ccl"), "ccl");
  assert.equal(sourceFlavorFromFilename("Post.cse"), "cse");
  assert.equal(sourceFlavorFromFilename("Mechanical.py"), "python");
  assert.equal(sourceFlavorFromFilename("workbench.wbjn"), "workbench");
  assert.equal(sourceFlavorFromFilename("notes.txt"), "generic");
  assert.equal(detectSourceFlavor(source), "cse");
  assert.equal(detectSourceFlavor(CCL_SAMPLE), "ccl");
});

test("parses all fixture formats through the same parser", () => {
  const fixtureRoot = fileURLToPath(new URL("../../testData/", import.meta.url));
  const readFixture = (name: string) =>
    fs.readFileSync(path.join(fixtureRoot, name), "utf8");

  const ccl = readFixture("CFX1.ccl");
  const cclVariables = parseVariables(ccl);
  const cclTarget = findVariableTarget(
    ccl,
    ccl.indexOf("Specific Heat Capacity = 4181.7"),
  );
  assert.equal(cclVariables.length, 269);
  assert.equal(cclTarget?.material, "Water");
  assert.equal(cclTarget?.line, 215);

  const cse = readFixture("Post.cse");
  const cseTarget = findVariableTarget(
    cse,
    cse.indexOf("Bound Radius"),
  );
  assert.equal(cseTarget?.path[0], "PLANE: Plane 1");

  const python = readFixture("Mechanical_Thermal.py");
  const pythonTarget = findVariableTarget(
    python,
    python.indexOf("body.Material"),
  );
  assert.equal(pythonTarget?.variableName, "body.Material");
  assert.ok(
    pythonTarget?.path.includes(
      "for body in ExtAPI.DataModel.GetObjectsByType(DataModelObjectCategory.Body)",
    ),
  );

  const workbench = readFixture("workbench.wbjn");
  const workbenchTarget = findVariableTarget(
    workbench,
    workbench.indexOf("engineeringData1 ="),
  );
  assert.equal(workbenchTarget?.variableName, "engineeringData1");
});
