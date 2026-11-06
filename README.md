# Program Studio

Program Studio 是一个 Electron 桌面客户端，用于按本机文件路径管理程序输入、参数定位、程序执行和输出提取。

## 功能

- 专业桌面工作台布局：左侧资源/参数树、中间源码编辑器、右侧参数属性/启动配置/定位规则检查器，以及默认折叠的底部运行输出，可拖拽调整。
- 亮色、暗色和跟随系统三种主题，编辑器与界面主题同步。
- 通过系统文件选择器直接读取本机文件路径和内容。
- 多文件参数管理，文件路径作为唯一标识。
- 自动、固定长度、分段、起始列、整行、多行、不定行、JSON、XML 和模式匹配等定位模式。
- 参数树按文件和输入/输出分类，属性面板支持参数类型、默认值、单位、备注和恢复默认值。
- 选中文本后可通过编辑器右键菜单添加输入或输出参数。
- 运行程序前自动保存生成工程，在生成工程副本中写入输入并提取输出。
- 提供无界面的工程执行工具，可按参数名覆盖输入、执行程序并返回本次输出。
- 桌面客户端直接启动本机程序，并展示标准输出、标准错误、退出码和耗时。
- 支持保存和加载目录式工程：独立保存启动配置、参数配置和所有引用文件。
- 支持原位保存和另存为，并在关闭客户端或替换当前工程前提示未保存更改。
- 内置基于 `fa1.config` 的完整示例，包含 138 个输入和 14 个输出参数。
- 数据仅在本机客户端处理，不上传服务器。

## 启动客户端

```bash
npm install
npm run dev
```

`npm run dev` 会启动 Vite 开发服务器并打开 Electron 桌面窗口。

常用快捷键：

- `Ctrl+O`：导入文件
- `Ctrl+Shift+O`：打开工程
- `Ctrl+S`：保存工程
- `Ctrl+Shift+S`：另存为
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

UI 测试包含桌面客户端路径读写和本机程序执行验证。

## 工程执行工具

`project:run` 读取自包含的目录式工程，按绑定 ID 或唯一参数名称覆盖输入值，在生成工程副本中执行程序并输出 JSON 报告。来源文件不会作为运行路径。

```bash
npm run project:run -- \
  --project "D:\Projects\MyProject" \
  --set-id "parameter-uuid=20" \
  --set-name "入口温度=550"
```

`--set-id` 和 `--set-name` 可以重复传入。需要一次提交多个覆盖值时，使用标准运行请求文件：

```json
{
  "schema": "program-studio-run-request",
  "schemaVersion": 1,
  "overrides": [
    {
      "selector": {
        "type": "bindingId",
        "id": "parameter-uuid"
      },
      "value": "20"
    },
    {
      "selector": {
        "type": "name",
        "name": "入口温度"
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
- 参数名称必须唯一；同名参数必须改用绑定 ID。
- 输出本次实际覆盖值、程序运行结果和本次提取到的输出参数值。
- `--timeout-ms 600000` 可调整超时时间，默认 10 分钟。

工程生成时会复制绑定文件，并把启动参数中的文件路径映射到生成工程。执行工具只在生成工程内部读写；原始来源文件不作为运行目标。

## 工程目录

工程不是单个配置文件，而是一个完整目录：

```text
MyProject/
  project.json
  launch.json
  parameters.json
  files/
    001-CFX1.ccl
    002-workbench.wbjn
```

- `project.json`：工程名称、版本和文件清单。
- `launch.json`：程序路径、参数和工作目录。
- `parameters.json`：输入/输出参数、类型、默认值、单位、备注及定位配置，使用工程 schema v3。
- `files/`：工程引用的全部文件内容。

## 文档

- [程序启动与参数绑定指南](docs/program-launcher.md)
