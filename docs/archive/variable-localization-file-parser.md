# 变量定位规则与扩展指南

> 归档说明：本文记录旧的“按文件扩展名选择解析器”方案，现已被统一文本解析器和可配置定位模式取代。当前规则见 [变量定位规则](../variable-localization-rules.md)。

本文档说明当前变量定位器的实现边界、识别规则、范围契约、优先级，以及后续新增规则时应遵循的流程。

## 1. 目标与非目标

当前定位器负责从文本中识别类似 `变量名 = 值 [单位]` 的赋值，并生成带有精确字符范围的 `ParsedVariable`。界面再根据用户选区找到对应变量并高亮。

当前实现的目标是：

- 支持 CCL、CSE、Python、Workbench 脚本和普通文本。
- 为变量名、值、单位和行保存可用于编辑的绝对字符范围。
- 在文本启发式可接受的成本下，覆盖项目中的真实文件格式。
- 保持定位结果的格式无关性，让 UI 只消费统一数据结构。

当前实现不是完整的 AST 或语义解析器，也不负责：

- 执行源码或验证变量值类型。
- 验证 Python 变量的真实作用域。
- 完整解析 Python 表达式、元组解包和复杂左值。
- 根据变量名自动判断多个同名变量是否代表同一业务对象。
- 提供可配置的规则注册表、匹配置信度或冲突告警。

## 2. 总体流程

核心实现集中在 [variables.ts](../src/lib/variables.ts)。

```text
原始文本
→ normalizeSourceText：统一换行符
→ detectSourceFlavor：判断源类型
→ parseVariables：按源类型选择解析器
→ 逐行识别赋值语句
→ 提取变量名、值、单位和范围
→ 补充块路径、Python 路径或上下文变量
→ 按源文本偏移量排序
→ 返回 ParsedVariable[]
```

解析器只负责生成结构化定位结果；React 组件不应重复实现文件类型判断、变量匹配或路径推导。

## 3. 范围契约

所有规则必须遵守以下约定：

- 解析前使用 `normalizeSourceText` 将 CRLF 和 CR 统一为 LF。
- 所有范围基于规范化后的源文本。
- 偏移量从 0 开始。
- 范围使用半开区间 `[start, end)`。
- 行号 `line` 从 1 开始。
- `lineEnd` 不包含行尾换行符。
- 内嵌文本必须转换为外层文档的绝对偏移量。
- 修改原文后，旧范围立即失效，必须重新解析。

`ParsedVariable` 定义于 [variables.ts](../src/lib/variables.ts#L20)，关键字段如下。

| 字段 | 语义 |
|---|---|
| `variableName` | 去除语法外围内容后的变量名 |
| `value` | 去除字符串引号、单位等内容后的值 |
| `rawValue` | 赋值号右侧的原始值文本 |
| `unit` | 包含方括号的单位，例如 `[kg m^-3]` |
| `line` | 1-based 行号 |
| `lineStart` | 整行在文档中的绝对起点 |
| `lineEnd` | 整行内容的绝对结束位置，不含换行符 |
| `nameRange` | 变量名在文档中的范围 |
| `valueRange` | 值内容在文档中的范围 |
| `unitRange` | 单位在文档中的范围，可为空 |
| `valuePrefix` | Python 字符串前缀，例如 `r`、`f` |
| `valueQuote` | 字符串引号分隔符，例如 `"`、`'''` |
| `path` | 从外到内的结构路径 |
| `material` | 从 CCL/CSE 路径提取的材料名 |
| `section` | 从路径提取的业务分区 |
| `contextValues` | 与当前变量关联的上游变量及其范围 |
| `flavor` | 源文件类型 |

由于 `nameRange`、`valueRange` 和 `unitRange` 都保留在原文坐标系中，它们既可用于高亮，也可作为后续反向编辑的基础。

## 4. 源类型检测

源类型定义如下：

```ts
type SourceFlavor = "generic" | "ccl" | "cse" | "python" | "workbench";
```

### 4.1 文件扩展名优先

| 扩展名 | 源类型 |
|---|---|
| `.ccl` | `ccl` |
| `.cse` | `cse` |
| `.py` | `python` |
| `.wbjn` | `workbench` |
| 其他 | `generic` |

当扩展名已经命中上述类型时，不再根据内容改判。实现见 [variables.ts](../src/lib/variables.ts#L71)。

### 4.2 内容探测

文件名未知或扩展名无法确定类型时，`detectSourceFlavor` 按以下顺序探测：

1. `workbench`：同时存在 `SetScriptVersion(`，并且三引号字符串中包含 `LIBRARY:`。
2. `ccl`：存在以 `LIBRARY:`、`MATERIAL:`、`PROPERTIES:`、`DOMAIN:` 或 `BOUNDARY:` 开头的行。
3. `cse`：存在以 `COMMAND FILE:` 或 `PLANE:` 开头的行。
4. `python`：存在 Python 块语句、`import`/`from`，或出现 `ExtAPI`/`DataModelObjectCategory`。
5. 以上均不满足时为 `generic`。

实现见 [variables.ts](../src/lib/variables.ts#L82)。

## 5. 赋值语句识别

赋值识别入口是 `parseAssignmentSyntax`，见 [variables.ts](../src/lib/variables.ts#L491)。

### 5.1 赋值等号

`findAssignmentEqual` 使用字符状态机寻找最外层的赋值等号：

- 跳过单引号、双引号和三引号内的内容。
- 跳过 `#` 之后的注释。
- 跳过圆括号、方括号和花括号内部的内容。
- 只接受括号深度为 0 的 `=`。
- 排除 `==`、`<=`、`>=`、`!=` 和 `:=`。
- 排除 `+=`、`-=`、`*=`、`/=`、`%=`、`&=`、`|=`、`^=` 和 `@=`。

因此比较表达式和命名参数不会被当成变量赋值：

```python
if body.Name == target_name:
    print(end="")
```

单行函数调用中的命名参数当前不会识别；多行函数调用参数则可能作为变量识别，详见第 6.3 节。

### 5.2 Python 和 Workbench 变量名

Python 和 Workbench 支持：

- 普通名称：`name`
- 属性访问：`object.attr`
- 索引访问：`array[index]`
- 组合形式：`object.items[index].value`
- 简单类型标注：`name: int = 1`

不接受：

- 元组解包：`a, b = values`
- 星号解包：`*items = values`
- 复杂表达式左值
- 任意非变量语义的左值

名称约束位于 `isPythonVariableName`，见 [variables.ts](../src/lib/variables.ts#L365)。

### 5.3 CCL、CSE 和普通文本变量名

CCL/CSE/Generic 使用更宽松的名称规则：

- 取赋值号左侧去掉首尾空白后的文本。
- 支持多词名称，例如 `Specific Heat Capacity`。
- 名称中包含 `=<>{}()[],"'` 等结构符号时拒绝。

名称解析入口见 [variables.ts](../src/lib/variables.ts#L371)。

## 6. 值、单位与上下文规则

### 6.1 值与字符串

赋号右侧先去除注释和首尾空白。Python/Workbench 优先尝试识别字符串字面量。

字符串规则：

- 支持 `r`、`u`、`b`、`f` 等前缀。
- 支持单引号、双引号和三引号。
- `value` 只包含引号内部的内容。
- `rawValue` 保留完整原文值。
- `valuePrefix` 保存字符串前缀。
- `valueQuote` 保存引号分隔符。
- `valueRange` 不包含前缀和引号。

例如：

```python
path = r"C:\temp\model.ccl"
```

解析后，`value` 是 `C:\temp\model.ccl`，而 `valueRange` 只覆盖引号内部的路径文本。实现见 [variables.ts](../src/lib/variables.ts#L401)。

### 6.2 单位

单位提取规则：

- 只处理以 `]` 结尾的值。
- 整个 RHS 中必须恰好出现一个 `[`。
- `unit` 保留方括号，例如 `[kg m^-3]`。
- `valueRange` 不包含单位。
- 数组 `[[...]]` 因存在多个 `[`，不会被识别为单位。

实现见 [variables.ts](../src/lib/variables.ts#L442)。

当前存在一个需要留意的启发式歧义：

```python
x = values[index]
```

该表达式可能被误识别为值 `values`、单位 `[index]`。新增 Python 表达式规则时，应优先修正这类冲突。

### 6.3 Python 上下文变量

`collectPythonPath` 根据缩进回溯当前赋值所在的块：

```text
async def / def / class /
if / elif / else / for / while /
with / try / except / finally
```

路径从外到内排列。解析器还会在当前位置之前最多 200 行的祖先路径中查找变量名，并尝试把对应赋值加入路径和 `contextValues`。

例如：

```python
target_body_name = "fati"
for body in bodies:
    if body.Name == target_body_name:
        body.Material = "material1"
```

路径为：

```ts
[
  "target_body_name = fati",
  "for body in bodies",
  "if body.Name == target_body_name"
]
```

实现见 [variables.ts](../src/lib/variables.ts#L586)。这是文本级关联，不验证 Python 作用域和变量遮蔽关系。

### 6.4 多行函数调用

如果赋值位于一个尚未闭合的多行 Python 函数调用中：

- 路径只记录 `函数名(...)`。
- 不继续叠加外层控制流路径。
- 多行调用参数可以被识别为变量。
- 参数末尾逗号不计入 `rawValue` 和 `valueRange`。

例如：

```python
matlProp1.SetData(
    Index=-1,
    Values=[["7930 [kg m^-3]"]],
)
```

`Values` 的路径为 `["matlProp1.SetData(...)"]`。函数调用识别入口见 [variables.ts](../src/lib/variables.ts#L140)。

### 6.5 CCL/CSE 块路径

CCL/CSE/Generic 根据缩进向前回溯块头：

- 跳过空行、`#` 注释行和 `END`。
- 识别形如 `LABEL: detail` 的行。
- 只有缩进严格小于当前层级时才进入父路径。
- 路径从外到内排列。
- Tab 按 4 个空格计算。

示例：

```text
LIBRARY
  MATERIAL: Water
    PROPERTIES
      SPECIFIC HEAT CAPACITY
```

对应路径：

```ts
[
  "LIBRARY",
  "MATERIAL: Water",
  "PROPERTIES",
  "SPECIFIC HEAT CAPACITY"
]
```

同时会派生：

- `material`：第一个 `MATERIAL:` 后的名称。
- `section`：从内向外找到的第一个非 `LIBRARY`、`MATERIAL`、`PROPERTIES` 路径项。

实现见 [variables.ts](../src/lib/variables.ts#L546)。

## 7. Workbench 内嵌 CCL

`.wbjn` 同时包含 Python 脚本和三引号内嵌的 CCL 文本。处理流程如下：

1. 查找三引号字符串块。
2. 只将包含 CCL/CSE 块头的内容视为内嵌 CCL。
3. 使用 CCL 块解析器解析内嵌内容。
4. 使用 `shiftVariable` 将行号和所有范围转换为外层 `.wbjn` 的绝对坐标。
5. 在路径前追加 `<变量名> · 内嵌 CCL` 或 `内嵌 CCL`。
6. Python 解析器跳过与内嵌 CCL 重叠的行，避免重复识别。
7. Python 变量和内嵌 CCL 变量合并后按源偏移量排序。

相关实现见 `findEmbeddedCclBlocks` 和 `parseWorkbenchVariables`：[variables.ts](../src/lib/variables.ts#L770)、[variables.ts](../src/lib/variables.ts#L826)。

新增内嵌格式时必须确保范围转换到原始文档坐标，不能直接把块内相对偏移量暴露给 UI 或编辑接口。

## 8. UI 定位流程

当前定位不只是“选中变量值”，而是把用户选区与所在赋值行关联起来。

```text
CodeMirror selection
→ App.handleEditorSelection
→ findVariableAt(selection.start)
→ 关联对应 ParsedVariable
→ locatedRange = 用户选区
→ App 将范围传给 SourceEditor
→ CodeMirror Decoration 渲染高亮
```

关键位置：

- 解析变量：[App.tsx](../src/App.tsx#L139)
- 按选区起点关联变量：[App.tsx](../src/App.tsx#L143)
- 处理编辑器选区：[App.tsx](../src/App.tsx#L164)
- 触发定位和高亮：[App.tsx](../src/App.tsx#L223)
- 将高亮范围传给 CodeMirror：[App.tsx](../src/App.tsx#L426)
- CodeMirror 高亮装饰：[SourceEditor.tsx](../src/components/SourceEditor.tsx#L44)

行为说明：

- 选区起点落在赋值行范围内时，可以关联到该变量。
- 选区可以覆盖变量名、完整值、数组中的单个元素或其他行内片段。
- 定位范围保留用户自己的选区，而不是强制改成 `valueRange`。
- `generatePattern` 当前不生成正则表达式，只执行关联、记录定位结果并重新选中范围。
- `selectVariableOccurrences` 已支持按变量名、路径和值筛选重复出现的位置，见 [variables.ts](../src/lib/variables.ts#L192)，但尚未接入 UI；界面目前仍显示固定的一处结果。

## 9. 当前优先级与冲突处理

当前没有统一的规则注册表，也没有显式 `priority` 字段。优先级来自源码中的固定执行顺序。

### 9.1 源类型优先级

```text
文件扩展名
→ workbench 内容探测
→ ccl 内容探测
→ cse 内容探测
→ python 内容探测
→ generic
```

扩展名命中后不会继续做内容探测。

### 9.2 解析优先级

```text
按 flavor 选择解析器
→ Python/Workbench 字符串字面量优先于单位解析
→ 多行函数调用路径优先于普通 Python 结构路径
→ Workbench 内嵌 CCL 排除重叠的 Python 行
→ 所有结果按源偏移量排序
```

### 9.3 当前未定义的行为

以下能力目前不存在：

- 同一行多个同类规则同时命中时的通用优先级。
- 规则冲突检测和告警。
- 匹配置信度。
- 规则开关或用户配置。
- 可配置规则注册表。
- 自动选择“最佳匹配”的机制。

新增规则时，不能继续把长期优先级隐含在函数调用顺序中。规则顺序变化应被视为行为契约变化。

## 10. 已知边界与风险

1. 当前解析是逐行文本和状态机启发式，不是完整语法树。
2. Python 上下文只做文本关联，不验证作用域、遮蔽或运行时关系。
3. 仅支持简单冒号类型标注。
4. 不支持元组解包、星号解包、walrus 运算符和复杂左值。
5. Python 索引表达式可能被误判为带单位值。
6. 普通跨行三引号字符串没有被当作一个完整变量值处理；Workbench 内嵌 CCL 是独立路径。
7. 单行函数参数被排除，多行函数参数被识别，这是当前有意的非对称行为。
8. CCL 路径依赖缩进；空格和 Tab 混用时可能产生层级偏差。
9. 同名变量没有统一身份模型，不能仅根据名称判断是否为同一业务变量。
10. 重复变量筛选能力尚未接入 UI。
11. 固定测试数据中的变量总数断言较脆弱，文件格式变化可能导致测试失败。

## 11. 新增规则的标准流程

### 11.1 先确定规则类型

新增需求首先应归类为：

| 类型 | 典型改动 |
|---|---|
| 现有 flavor 的新赋值语法 | 扩展赋值匹配分支 |
| 新文件类型或新 flavor | 扩展类型检测和解析器路由 |
| 新路径或上下文推断 | 扩展块路径或 Python 路径逻辑 |
| 变量名、值或单位的识别变体 | 扩展对应字段解析器 |
| 内嵌文本格式 | 新增内嵌块查找、子解析器和绝对偏移转换 |

不要先从 UI 入手。只要最终数据仍符合 `ParsedVariable` 契约，UI 通常不需要知道新的文件格式。

### 11.2 定义规则契约

每条新规则必须先明确：

- 规则 ID 和适用 flavor。
- 匹配条件。
- 正例和反例。
- 变量名范围如何计算。
- 值范围和 `rawValue` 的边界。
- 单位是否提取，以及 `unitRange` 的边界。
- 路径和 `contextValues` 的来源。
- 与已有规则重叠时的优先级。
- 解析结果是否用于高亮、筛选或后续替换。

### 11.3 选择扩展位置

#### 新 flavor

依次修改：

1. `SourceFlavor`。
2. `sourceFlavorFromFilename`。
3. `detectSourceFlavor`。
4. `parseVariables` 的解析器分派。
5. 新增独立解析器和测试夹具。

#### 现有 flavor 的新赋值语法

优先在 `parseAssignmentSyntax` 增加有明确边界的识别分支。新分支应继续返回 `AssignmentParts`，并复用 `finishVariable`，避免产生第二套字段语义。

#### 新路径规则

路径逻辑应独立返回 `path` 和 `contextValues`。不要把路径推断写入 React 组件，也不要在点击高亮时临时计算。

#### 复杂格式

当解析逻辑明显增大时，应拆分为独立文件，例如：

```text
src/lib/parsers/<flavor>.ts
```

独立解析器通过稳定接口返回 `ParsedVariable[]`；`variables.ts` 只保留公共类型、源类型路由和共享工具。

### 11.4 引入显式优先级

如果新增规则可能与现有规则匹配同一行，建议引入以下形式的规则注册表。该接口是建议方案，目前尚未实现。

```ts
interface VariableRuleContext {
  source: string;
  lineText: string;
  lineStart: number;
  lineNumber: number;
  flavor: SourceFlavor;
}

interface VariableRule {
  id: string;
  priority: number;
  match(context: VariableRuleContext): AssignmentParts | null;
}
```

优先级要求：

- 数值更大的规则先执行。
- 优先级相同时必须保持稳定的显式顺序。
- 默认采用 first-match：第一条成功规则产生结果后停止。
- 如果规则需要合并，应使用独立的 merge 阶段，并明确冲突字段的归属。
- 所有重叠规则必须至少有一个单元测试描述预期胜者。
- 调试时最好能输出规则 ID 和匹配范围，方便定位误识别。

数组插入顺序可以作为同优先级规则的稳定兜底，但不应成为唯一优先级来源。

### 11.5 保持范围与坐标正确

新规则必须检查：

- 是否从规范化文本上计算范围。
- 子字符串切片是否与 JSON 字段一致。
- 是否遗漏字符串前缀、引号或尾随逗号。
- 内嵌内容是否转换到外层绝对偏移。
- 结果排序后是否仍能按选区位置正确查找。

### 11.6 必须补充的测试

至少覆盖：

- 新规则正例。
- 近似但不应命中的反例。
- `nameRange` 切片结果。
- `valueRange` 切片结果。
- `unitRange` 切片结果。
- `rawValue` 与原文一致性。
- 行号和 `lineStart`/`lineEnd`。
- CRLF 规范化。
- 路径、`material`、`section` 和 `contextValues`。
- 多条规则的优先级。
- 同名变量重复出现。
- 内嵌格式的绝对坐标。
- 真实 `testData` 夹具。

测试位置：

- 解析和数据结构：[variables.test.ts](../src/lib/variables.test.ts#L28)
- 编辑器和高亮集成：[variable-locator.spec.ts](../tests/e2e/variable-locator.spec.ts#L58)

建议验证命令：

```bash
npm test
npm run build
npm run test:ui
```

如果新规则只影响真实文件格式而没有稳定通用夹具，应增加对应 `testData` 文件，但避免对全文件变量总数做过度刚性的断言。

### 11.7 同步更新文档

规则实现和测试完成后，同步更新本文档中的：

- 支持类型矩阵。
- 源类型检测顺序。
- 赋值、值和单位规则。
- 路径和上下文规则。
- 冲突优先级。
- 已知限制。
- 测试覆盖范围。

## 12. 规则覆盖矩阵

| 能力 | CCL | CSE | Python | Workbench | Generic |
|---|---:|---:|---:|---:|---:|
| 基本 `name = value` | 是 | 是 | 是 | 是 | 是 |
| 多词变量名 | 是 | 是 | 否 | 否 | 是 |
| 属性或索引左值 | 否 | 否 | 是 | 是 | 否 |
| Python 类型标注 | 否 | 否 | 是 | 是 | 否 |
| 字符串前缀和引号拆分 | 否 | 否 | 是 | 是 | 否 |
| 尾部单位 | 是 | 是 | 是 | 是 | 是 |
| 缩进块路径 | 是 | 是 | 否 | 内嵌 CCL 支持 | 是 |
| Python 控制流路径 | 否 | 否 | 是 | 是 | 否 |
| 多行函数调用路径 | 否 | 否 | 是 | 是 | 否 |
| 内嵌 CCL | 否 | 否 | 否 | 是 | 否 |

## 13. 核心维护原则

后续修改应以以下原则为准：

1. 解析逻辑集中在 `src/lib/`，UI 只消费 `ParsedVariable`。
2. 所有定位结果使用规范化原文上的绝对半开区间。
3. 规则必须能用正例、反例和范围切片测试说明。
4. 规则冲突必须有显式优先级，不能只依赖碰巧的代码顺序。
5. 新增内嵌格式必须正确转换绝对坐标。
6. 解析结果变化后必须重新解析，不能复用旧范围。
7. 不把“同名”当作跨作用域、跨块或跨材料的可靠身份。
