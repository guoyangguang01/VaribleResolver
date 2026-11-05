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

export function buildFa1Example(): Fa1Example {
  const config = exampleConfig as ExampleExecutionConfig;
  const fa1Config = JSON.parse(fa1ConfigSource) as Fa1Config;
  const files = config.files.map((file) => {
    const content = ASSETS[file.asset];
    if (content === undefined) {
      throw new Error(`示例资源不存在：${file.asset}`);
    }
    return createLaunchFile(file.path, normalizeSourceText(content));
  });
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const modulePaths: Record<string, string> = {
    "CFX1[In]": "C:\\Cases\\fa1\\CFX1.ccl",
    "Post[In]": "C:\\Cases\\fa1\\Post.cse",
    "Mechanical_Thermal[In]":
      "C:\\Cases\\fa1\\Mechanical_Thermal.py",
    "Mechanical_Structural-2019[In]":
      "C:\\Cases\\fa1\\Mechanical_Structural-2019.py",
    "workbench[In]": "C:\\Cases\\fa1\\workbench.wbjn",
    "Stress_Envelope_Summary[Out]":
      "C:\\Cases\\fa1\\Stress_Envelope_Summary.txt",
  };
  let freeParameterIndex = 0;
  const bindings = fa1Config.parameters.map((parameter, index) => {
    const direction =
      parameter.direction === 0 ? "input" : "output";
    const name = `${parameter.moduleName} · ${parameter.name}`;
    if (parameter.moduleName === "自由参数") {
      const file = filesByPath.get("C:\\Cases\\fa1\\ResultManifest.txt");
      if (!file) throw new Error("示例自由参数清单不存在。");
      freeParameterIndex += 1;
      return createBindingFromLocator(
        file,
        createLocatorForMode("delimited", {
          startRowIndex: freeParameterIndex,
          separator: " = ",
          fieldIndex: 1,
        }),
        direction,
        `fa1-${direction}-${index}`,
        name,
      );
    }
    const filePath = modulePaths[parameter.moduleName];
    const file = filePath ? filesByPath.get(filePath) : null;
    if (!file) {
      throw new Error(`示例参数模块没有文件映射：${parameter.moduleName}`);
    }
    return createBindingFromRowColumn(
      file,
      parameter,
      direction,
      `fa1-${direction}-${index}`,
      name,
    );
  });

  return {
    name: config.name,
    program: config.program,
    arguments: config.arguments,
    workingDirectory: config.workingDirectory,
    files,
    bindings,
  };
}
