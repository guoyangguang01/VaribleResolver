# 行定位自动重定位方案

## 1. 文档目的

本文档定义编辑源文件后自动更新参数行定位的方案。

第一阶段目标是：

- 编辑器中发生跨行插入或删除时，已定位参数的行号自动跟随移动。
- 直接改写已定位文本时，同步更新参数默认值。
- 目标内容被删除或剪切时，明确标记定位失效，不猜测新位置。
- 保持现有工程格式和执行流程兼容。

本文档描述已完成的第一阶段实现。跨行编辑会自动更新行坐标；同一行内的列偏移仍不在当前范围内。

各定位类型的解析和重定位行为见 [定位策略规格](./locator-strategies.md)。

## 2. 实现前的问题

当前编辑器只把完整的新文本传给上层：

- `SourceEditor.onChange` 只提供 `value`。
- 编辑文件时只更新文件内容和大小，不更新参数绑定。
- 参数定位器仍使用编辑前的绝对行列或语义规则。
- 在参数上方插入或删除行后，旧行号可能指向错误内容。
- 定位解析失败时，高亮会直接消失，界面没有明确的失效状态。

现有 `autoPosition.tokenRange` 可以适配同一行内值长度变化，但无法处理跨行编辑。输入写回逻辑可以调整少量定位器，但不适用于用户在编辑器中直接修改文本的场景。

### 2.1 当前实现

- `SourceEditor` 会同时提供新文本和 CodeMirror 精确变更区间。
- 文件内容变化时调用 `relocateBindingsAfterEdit` 更新参数定位器。
- 跨行插入或删除会自动更新自动、固定长度、起始列、整行、多行和分段定位器的行号。
- 直接编辑目标文本会更新 `defaultValue`，`value` 保持不变。
- 删除或剪切完整目标文本会设置 `locatorInvalid`，界面显示“定位失效”。
- 删除后使用撤销恢复原文本时，会自动重新验证并清除失效状态。
- 用户点击“修改定位”并重新应用定位后，失效状态清除。

## 3. 目标与非目标

### 3.1 目标

- 使用 CodeMirror 的精确变更区间，而不是比较前后文本猜测差异。
- 自动调整所有基于行号或行列坐标的定位器。
- 目标文本被直接编辑时，将新的解析结果写入 `defaultValue`。
- 保留 `value` 作为执行模式中的当前输入值，不因编辑器修改而变化。
- 定位失效状态可显示、可保存，并可由用户重新定位后清除。
- 不改变现有工程结构；`locatorInvalid` 继续作为可选字段保存。

### 3.2 非目标

- 不进行全文旧值搜索。
- 不根据文本相似度、上下文或距离猜测新位置。
- 不自动恢复被剪切到其他位置的参数。
- 第一阶段不处理同一行内目标文本前方的列偏移。
- 不改变 JSON、XML、标记和正则定位器的语义规则。
- 不改变程序执行阶段只使用工程副本的原则。

## 4. 定位模式范围

第一阶段需要调整行坐标的定位器：

| 定位模式 | locator kind | 调整字段 |
|---|---|---|
| 自动 | `autoPosition` | `startRowIndex`、`endRowIndex` |
| 固定长度 | `rowColumn` | `startRowIndex`、`endRowIndex` |
| 起始列 | `startColumn` | `rowIndex` |
| 整行 | `wholeLine` | `rowIndex` |
| 多行 | `multiLine` | `startRowIndex`、`endRowIndex` |
| 分段 | `delimited` | `rowIndex` |

以下语义定位器第一阶段保持规则不变：

- `jsonPath`
- `xmlPath`
- `marker`
- `pattern`

这些规则在每次解析时已经会基于新文本重新求值；解析失败时进入定位失效状态。

## 5. 编辑器变更接口

### 5.1 当前接口

```ts
interface SourceEditorProps {
  onChange: (value: string) => void;
}
```

### 5.2 新接口

```ts
interface SourceTextChange {
  from: number;
  to: number;
  insert: string;
}

interface SourceEditorChange {
  value: string;
  changes: SourceTextChange[];
}

interface SourceEditorProps {
  onChange: (change: SourceEditorChange) => void;
}
```

`changes` 来自 CodeMirror 的 `update.changes.iterChanges()`。程序主动同步外部值时不触发普通编辑回调，避免程序写回被误判为手工编辑。

## 6. 重定位算法

新增纯函数：

```ts
interface RelocationResult {
  bindings: LaunchBinding[];
  invalidatedParameterKeys: string[];
}

function relocateBindingsAfterEdit(
  filePath: string,
  previousContent: string,
  nextContent: string,
  changes: SourceTextChange[],
  bindings: LaunchBinding[],
): RelocationResult;
```

处理步骤：

1. 只处理 `filePath` 指向当前文件的绑定。
2. 使用编辑前内容解析绑定旧范围。
3. 计算每个变更删除和插入的换行数量。
4. 对每一行坐标锚点，累计所有位于该行起始位置之前的换行差值。
5. 将差值应用到对应定位器的行号字段。
6. 如果编辑范围与参数目标范围相交，使用新内容重新解析目标值。
7. 解析成功时更新 `defaultValue`，不修改 `value`。
8. 目标被完整删除、解析失败或行号小于 1 时设置 `locatorInvalid`。

行号差值计算：

```text
rowDelta =
  insertedLineBreakCount
  - deletedLineBreakCount
```

只有发生在目标行起始位置之前的行号变化才影响该目标。目标之后的行插入或删除不影响当前参数。

定位器行号调整由对应策略的 `relocate()` 实现：坐标策略映射行号，语义策略保持规则不变。调度器本身不再根据 `locator.kind` 维护集中式 `switch`。

## 7. 值更新规则

### 7.1 跨行编辑

在目标上方插入或删除行时：

- 更新定位器行号。
- 不更新 `defaultValue`。
- 不更新 `value`。

### 7.2 直接编辑目标文本

用户直接改写参数覆盖的文本时：

- 重新解析目标范围。
- 更新 `defaultValue`。
- 保持 `value` 不变。
- 保持参数类型、单位、备注和名称不变。

`value` 表示执行模式下本次运行的输入值，不属于配置默认值。

### 7.3 删除或剪切目标

目标内容被完整删除或剪切时：

- 不进行全文搜索。
- 不匹配同值文本。
- 不把定位器移动到相邻行。
- 设置 `locatorInvalid: true`。
- 记录删除位置锚点；如果撤销在原位置恢复原默认值，则自动恢复定位。
- 剪切到其他位置或无法匹配原删除位置时，保留参数配置，等待用户手动重新设置定位。

## 8. 定位失效状态

`LaunchBinding` 增加可选字段：

```ts
interface LaunchBinding {
  // 现有字段...
  locatorInvalid?: boolean;
}
```

约束：

- 该字段为可选字段，不升级工程 schema。
- 保存工程时，失效状态写入 `parameters.json`。
- 读取缺少该字段的现有工程时按 `false` 处理。
- 用户重新设置或应用定位后清除该字段。
- 参数树显示“定位失效”，并使用明显的错误状态样式。
- 定位失效的参数不提供高亮范围，点击定位时提示需要重新定位。

## 9. 状态更新流程

```text
CodeMirror 文档变更
  |
  v
SourceEditor 提供 value + changes
  |
  v
relocateBindingsAfterEdit
  |
  +--> 更新绑定定位器和 default value
  +--> 标记无法恢复的绑定
  |
  v
一次状态更新
  |
  +--> 文件内容和高亮
  +--> 参数树和属性面板
  +--> 未保存状态
```

文件内容和参数绑定应在同一编辑事件中完成计算，避免中间状态导致高亮与参数树不一致。

## 10. 已知限制

- 第一阶段不调整同一行内的列坐标。目标所在行前方增加或删除字符后，参数仍可能指向偏移后的字符。
- 只有撤销在同一删除锚点恢复原默认值时才会自动恢复；其他编辑或重新粘贴不会自动找回。
- 被剪切并粘贴到其他位置的内容不会自动找回。
- 语义定位器不更新规则字段，只根据新文本重新求值。

## 11. 测试方案

### 11.1 单元测试

- 在目标上方插入单行，验证所有行坐标模式增加 1。
- 在目标上方删除多行，验证行号减少对应数量。
- 在目标下方插入或删除行，验证定位不变。
- 多行定位同时更新起始行和结束行。
- 直接改写目标文本，验证只更新 `defaultValue`。
- 验证 `value` 和目标参数类型保持不变。
- 删除整个目标范围后标记 `locatorInvalid`。
- 同一行前方插入字符时，按照第一阶段约定不修改列号。
- JSON/XML/标记/正则定位器字段保持不变。
- 连续编辑和撤销重做后，行号映射仍然正确。

### 11.2 UI 测试

- 在编辑器中插入新行后，参数树和属性面板中的行号立即更新。
- 参数高亮跟随更新后的位置。
- 直接编辑目标文本后，默认值输入框更新，当前值输入框不变。
- 删除目标内容后显示“定位失效”。
- 撤销删除后自动恢复定位和行号。
- 重新设置定位后失效状态消失。

### 11.3 工程往返测试

- 保存并重新打开工程后，更新后的行定位保持不变。
- `locatorInvalid` 状态可以保存和恢复。
- 现有工程缺少 `locatorInvalid` 时仍可正常加载。

## 12. 验收标准

- 跨行插入或删除后，所有行坐标定位器指向原逻辑目标所在行。
- 直接编辑目标文本时，默认值同步更新，当前值不变化。
- 删除或剪切目标内容时显示明确的定位失效状态，不发生错误猜测。
- 撤销删除时，只有原位置恢复原默认值才自动恢复定位。
- 语义定位器规则和工程 schema 版本不发生变化。
- `npm test`、`npm run build` 和现有 UI/Electron 测试全部通过。

## 13. 实施顺序（已完成）

1. 扩展 `SourceEditor` 变更事件并补充类型。
2. 实现纯函数 `relocateBindingsAfterEdit` 和单元测试。
3. 将文件内容编辑与绑定重定位合并到同一次状态更新。
4. 增加 `locatorInvalid` 的显示、保存和加载兼容。
5. 补充 UI、工程往返和回归测试。
6. 更新 README 和功能文档。
