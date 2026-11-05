# Program Studio

Program Studio 是一个 Electron 桌面客户端，用于按本机文件路径管理程序输入、参数定位、程序执行和输出提取。

## 功能

- 通过系统文件选择器直接读取本机文件路径和内容。
- 多文件参数管理，文件路径作为唯一标识。
- 自动、固定长度、分段、起始列、整行、多行、不定行、JSON、XML 和模式匹配等定位模式。
- 高密度参数表，支持方向筛选、参数搜索、修改定位和删除参数。
- 输入值写回原文件，支持保存到磁盘。
- 桌面客户端直接启动本机程序，并展示标准输出、标准错误、退出码和耗时。
- 程序完成后自动重新读取文件并提取输出参数。
- 支持保存和加载目录式工程：独立保存启动配置、参数配置和所有引用文件。
- 内置基于 `fa1.config` 的完整示例，包含 138 个输入和 14 个输出参数。
- 数据仅在本机客户端处理，不上传服务器。

## 启动客户端

```bash
npm install
npm run dev
```

`npm run dev` 会启动 Vite 开发服务器并打开 Electron 桌面窗口。

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
- `parameters.json`：输入/输出参数及定位配置。
- `files/`：工程引用的全部文件内容。

## 文档

- [程序启动与参数绑定指南](docs/program-launcher.md)
