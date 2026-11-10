import cfxSource from "../../testData/CFX1.ccl?raw";
import postSource from "../../testData/Post.cse?raw";
import thermalSource from "../../testData/Mechanical_Thermal.py?raw";
import structuralSource from "../../testData/Mechanical_Structural-2019.py?raw";
import workbenchSource from "../../testData/workbench.wbjn?raw";
import stressSource from "../../testData/fa1-example/Stress_Envelope_Summary.txt?raw";
import manifestSource from "../../testData/fa1-example/ResultManifest.txt?raw";
import fa1ConfigSource from "../../testData/fa1.config?raw";
import exampleConfig from "../../testData/fa1-example.execution.json";
import {
  createBindingFromLocator,
  createBindingFromRowColumn,
  createLaunchFile,
  createLocatorForMode,
  type LaunchBinding,
  type LaunchFile,
  type LaunchParameterType,
} from "./launcher.ts";
import { normalizeSourceText } from "./variables.ts";

interface ExampleAsset {
  path: string;
  asset: string;
}

interface Fa1Parameter {
  moduleName: string;
  name: string;
  direction: number;
  dataType: number;
  defaultText: string;
  originText: string;
  startRowIndex: number;
  startColumnIndex: number;
  endRowIndex: number;
  endColumnIndex: number;
  unit: string;
}

interface Fa1Config {
  parameters: Fa1Parameter[];
}

interface ExampleExecutionConfig {
  schemaVersion: number;
  name: string;
  referenceConfig: string;
  program: string;
  arguments: string;
  workingDirectory: string;
  files: ExampleAsset[];
}

export interface Fa1Example {
  name: string;
  program: string;
  arguments: string;
  workingDirectory: string;
  launchMode?: "direct" | "shell";
  files: LaunchFile[];
  bindings: LaunchBinding[];
}

const ASSETS: Record<string, string> = {
  "CFX1.ccl": cfxSource,
  "Post.cse": postSource,
  "Mechanical_Thermal.py": thermalSource,
  "Mechanical_Structural-2019.py": structuralSource,
  "workbench.wbjn": workbenchSource,
  "fa1-example/Stress_Envelope_Summary.txt": stressSource,
  "fa1-example/ResultManifest.txt": manifestSource,
};

const EXAMPLE_ROOT_PLACEHOLDER = "{{EXAMPLE_ROOT}}";

function examplePath(root: string, relativePath: string): string {
  const normalizedRoot = root.trim().replace(/[\\/]+$/, "");
  const separator = normalizedRoot.includes("\\") ? "\\" : "/";
  const normalizedRelativePath = relativePath
    .trim()
    .replace(/^[\\/]+/, "")
    .replace(/[\\/]+/g, separator);
  return `${normalizedRoot}${separator}${normalizedRelativePath}`;
}

function resolveExamplePath(value: string, root: string): string {
  return value.replaceAll(EXAMPLE_ROOT_PLACEHOLDER, root);
}

function fa1ParameterType(dataType: number): LaunchParameterType {
  if (dataType === 1) return "number";
  if (dataType === 2) return "boolean";
  if (dataType === 3) return "path";
  return "text";
}

function fa1Unit(value: string): string {
  return value.trim().match(/\[([^\]]+)\]\s*$/)?.[1] ?? "";
}

export function buildFa1Example(assetRoot: string): Fa1Example {
  const config = exampleConfig as ExampleExecutionConfig;
  const fa1Config = JSON.parse(fa1ConfigSource) as Fa1Config;
  const files = config.files.map((file) => {
    const content = ASSETS[file.asset];
    if (content === undefined) {
      throw new Error(`示例资源不存在：${file.asset}`);
    }
    return createLaunchFile(
      resolveExamplePath(file.path, assetRoot),
      normalizeSourceText(content),
    );
  });
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const modulePaths: Record<string, string> = {
    "CFX1[In]": examplePath(assetRoot, "CFX1.ccl"),
    "Post[In]": examplePath(assetRoot, "Post.cse"),
    "Mechanical_Thermal[In]": examplePath(
      assetRoot,
      "Mechanical_Thermal.py",
    ),
    "Mechanical_Structural-2019[In]": examplePath(
      assetRoot,
      "Mechanical_Structural-2019.py",
    ),
    "workbench[In]": examplePath(assetRoot, "workbench.wbjn"),
    "Stress_Envelope_Summary[Out]": examplePath(
      assetRoot,
      "fa1-example/Stress_Envelope_Summary.txt",
    ),
  };
  let freeParameterIndex = 0;
  const bindings = fa1Config.parameters.map((parameter) => {
    const direction =
      parameter.direction === 0 ? "input" : "output";
    const name = parameter.name;
    if (parameter.moduleName === "自由参数") {
      const file = filesByPath.get(
        examplePath(assetRoot, "fa1-example/ResultManifest.txt"),
      );
      if (!file) throw new Error("示例自由参数清单不存在。");
      freeParameterIndex += 1;
      return {
        ...createBindingFromLocator(
          file,
          createLocatorForMode("delimited", {
            startRowIndex: freeParameterIndex,
            separator: " = ",
            fieldIndex: 1,
          }),
          direction,
          name,
        ),
        parameterType: fa1ParameterType(parameter.dataType),
        defaultValue: parameter.defaultText,
        unit: fa1Unit(parameter.unit),
      };
    }
    const filePath = modulePaths[parameter.moduleName];
    const file = filePath ? filesByPath.get(filePath) : null;
    if (!file) {
      throw new Error(`示例参数模块没有文件映射：${parameter.moduleName}`);
    }
    return {
      ...createBindingFromRowColumn(
        file,
        parameter,
        direction,
        name,
      ),
      parameterType: fa1ParameterType(parameter.dataType),
      defaultValue: parameter.defaultText,
      unit: fa1Unit(parameter.unit),
    };
  });

  return {
    name: config.name,
    program: config.program,
    arguments: resolveExamplePath(config.arguments, assetRoot),
    workingDirectory: resolveExamplePath(config.workingDirectory, assetRoot),
    launchMode: "direct",
    files,
    bindings,
  };
}
