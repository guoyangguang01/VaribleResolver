# Program Studio

Program Studio 是一个 Electron 桌面客户端，用于按本机文件路径管理程序输入、参数定位、程序执行和输出提取。

## 功能

- 专业桌面工作台布局：左侧资源/参数树、中间源码编辑器、右侧参数属性/启动配置/定位规则检查器，以及默认折叠的底部运行输出，可拖拽调整。
- 亮色、暗色和跟随系统三种主题，编辑器与界面主题同步。
- 通过系统文件选择器直接读取本机文件路径和内容。
- 多文件参数管理，文件路径作为唯一标识。
- 自动、固定长度、分段、起始列、整行、多行、不定行、JSON、XML 和模式匹配等定位模式。
- 参数树按文件和输入/输出分类，属性面板支持文本、数值、布尔和路径四种参数类型。
- 输入参数支持 `@文件名[In].参数名` 引用，同一逻辑输入可同步写入多个文件。
- 支持手动添加不关联文件的自由输入/输出参数；自由输入用于启动参数替换，自由输出可引用绑定输出或手动赋值。
- 选中文本后可通过编辑器右键菜单添加输入或输出参数。
- 编辑文件引起跨行位移时，已定位参数会自动更新行号；目标被删除时显示定位失效。
- 运行程序前自动保存工程定义，并在独立 `runs/<runId>` 工作区中写入输入、启动程序和提取输出。
- 提供无界面的工程执行工具，可按参数名覆盖输入、执行程序并返回本次输出。
- 桌面客户端直接启动本机程序，并展示标准输出、标准错误、退出码和耗时。
- 支持保存和加载目录式工程：独立保存启动配置、参数配置和所有引用文件。
- 手动保存会更新已修改的来源文件，同时维护工程目录副本；另存为只创建新工程。
- 支持原位保存和另存为，并在关闭客户端或替换当前工程前提示未保存更改。
- 内置基于 `fa1.config` 的完整示例，包含 138 个输入和 14 个输出参数。
- 数据仅在本机客户端处理，不上传服务器。

## 启动客户端

```bash
npm install
npm run dev
```

`npm run dev` 会启动 Vite 开发服务器并打开 Electron 桌面窗口。

客户端启动后会自动打开仓库中的 `default-project`。需要根据 `testData` 重新生成默认工程时运行：

```bash
npm run default:create
```

常用快捷键：

- `Ctrl+N`：新建空白工程
- `Ctrl+O`：导入文件
- `Ctrl+Shift+O`：打开工程
- `Ctrl+S`：保存工程并更新已修改的来源文件
- `Ctrl+Shift+S`：另存为，不修改来源文件
- `Ctrl+Enter`：添加输入参数
- `Ctrl+Shift+Enter`：运行程序

构建前端资源后启动客户端：

```bash
npm run client
```

生成 Windows 安装包和便携版：

```bash
npm run package
```

只生成未安装的应用目录：

```bash
npm run package:dir
```

## 测试

```bash
npm test
npm run test:ui
```

UI 测试直接启动 Electron，覆盖桌面路径读写、工程打开保存和本机程序执行。

## 工程执行工具

`project:run` 读取目录式工程，按 `文件名.参数名` 复合主键覆盖输入值，为本次执行创建独立运行工作区并输出 JSON 报告。工程定义和来源文件不会作为本次运行的可写目标。

```bash
npm run project:run -- \
  --project "D:\Projects\MyProject" \
  --set "CFX1.入口温度=550" \
  --set "case.求解时间=20" \
  --set "自由参数.材料=steel"
```

`--set` 可以重复传入。文件名可以带扩展名，也可以省略。需要一次提交多个覆盖值时，使用标准运行请求文件：

```json
{
  "schema": "program-studio-run-request",
  "schemaVersion": 2,
  "overrides": [
    {
      "selector": {
        "type": "parameter",
        "fileName": "CFX1",
        "parameterName": "入口温度"
      },
      "value": "20"
    },
    {
      "selector": {
        "type": "parameter",
        "fileName": "case.ccl",
        "parameterName": "求解时间"
      },
      "value": "550"
    }
  ]
}
```

```bash
npm run project:run -- \
  --project "D:\Projects\MyProject" \
  --request run-request.json
```

- 只处理请求中指定的覆盖目标，不扫描或写回未覆盖输入。
- 参数主键是 `文件名 + 参数名`；不同文件允许使用相同参数名。
- 输出本次实际覆盖值、程序运行结果和本次提取到的输出参数值。
工程生成时会复制绑定文件，并把启动参数中的文件路径映射到工程定义。执行工具再把工程定义复制到 `runs/<runId>`，只在本次运行工作区中读写。

## 工程目录

工程不是单个配置文件，而是一个完整目录：

```text
MyProject/
  project.json
  launch.json
  parameters.json
  outputs.json
  files/
    001-CFX1.ccl
    002-workbench.wbjn
  runs/
    run-20261109-093000-001/
      project.json
      launch.json
      parameters.json
      outputs.json
      files/
```

- `project.json`：工程名称、版本和文件清单。
- `launch.json`：启动方式、程序路径、参数、工作目录和环境变量。
- `parameters.json`：输入/输出参数、类型、默认值、单位、备注及定位配置。
- `outputs.json`：参考输出文件、实际运行路径、必需性和 seed 策略。
- `files/`：工程引用的全部文件内容。
- `runs/`：本机运行状态，不属于可分发的工程定义；每次执行创建独立工作区。

工程定义只支持当前 `schemaVersion: 4`。参考输出默认 `seed: "never"`，不会作为运行时输出复制。

## 文档

- [程序启动与参数绑定指南](docs/program-launcher.md)
- [行定位自动重定位方案](docs/line-relocation-plan.md)
