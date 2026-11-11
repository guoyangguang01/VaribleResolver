import cfxSource from "../../testData/CFX1.ccl?raw";
import postSource from "../../testData/Post.cse?raw";
import thermalSource from "../../testData/Mechanical_Thermal.py?raw";
import structuralSource from "../../testData/Mechanical_Structural-2019.py?raw";
import workbenchSource from "../../testData/workbench.wbjn?raw";
import stressSource from "../../testData/fa1-example/Stress_Envelope_Summary.txt?raw";
import fa1ConfigSource from "../../testData/fa1.config?raw";
import cfxSetupSource from "../../testData/CFX_setup_0.ccl?raw";
import coordinateScriptSource from "../../testData/jiaobencfx_coord.ccl?raw";
import accelerationSource from "../../testData/31acc.txt?raw";
import exampleConfig from "../../testData/fa1-example.execution.json";
import {
  createBindingFromLocator,
  createBindingFromRowColumn,
  createLaunchFile,
  type LaunchBinding,
  type LaunchFile,
  type LaunchFileRole,
  type LaunchParameterType,
} from "./launcher.ts";

interface ExampleAsset {
  path: string;
  asset: string;
  roles?: LaunchFileRole[];
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
  "CFX_setup_0.ccl": cfxSetupSource,
  "jiaobencfx_coord.ccl": coordinateScriptSource,
  "31acc.txt": accelerationSource,
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

function normalizedExampleValue(value: string): string {
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.startsWith("@") ||
    (!/^#UCW_/i.test(trimmed) && !/^[A-Za-z]:[\\/]/.test(trimmed))
  ) {
    return value;
  }
  const fileName = trimmed.split(/[\\/]/).filter(Boolean).at(-1);
  return fileName
    ? `#UCW_PRJ_DIR#\\files\\${fileName}`
    : value;
}

function exampleInputReference(
  value: string,
  direction: "input" | "output",
): string | undefined {
  const trimmed = value.trim();
  return direction === "input" && /^@.+\[In\]\..+$/i.test(trimmed)
    ? trimmed
    : undefined;
}

export function buildFa1Example(assetRoot: string): Fa1Example {
  const config = exampleConfig as ExampleExecutionConfig;
  const fa1Config = JSON.parse(fa1ConfigSource) as Fa1Config;
  const files = config.files.map((file) => {
    const content = ASSETS[file.asset];
    if (content === undefined) {
      throw new Error(`示例资源不存在：${file.asset}`);
    }
    const launchFile = createLaunchFile(
      resolveExamplePath(file.path, assetRoot),
      content,
    );
    return {
      ...launchFile,
      roles: file.roles,
    };
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
  const bindings = fa1Config.parameters.map((parameter) => {
    const direction: "input" | "output" =
      parameter.direction === 0 ? "input" : "output";
    const name = parameter.name;
    const defaultValue = normalizedExampleValue(parameter.defaultText);
    const inputReference = exampleInputReference(
      parameter.defaultText,
      direction,
    );
    if (parameter.moduleName === "自由参数") {
      return {
        scope: "free" as const,
        module: parameter.moduleName,
        name,
        direction,
        value: defaultValue,
        parameterType: fa1ParameterType(parameter.dataType),
        defaultValue,
        unit: fa1Unit(parameter.unit),
        description: "",
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
      module: parameter.moduleName,
      ...(inputReference ? { inputReference } : {}),
      parameterType: fa1ParameterType(parameter.dataType),
      defaultValue,
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
