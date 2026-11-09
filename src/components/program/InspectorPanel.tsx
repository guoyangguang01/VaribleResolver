import {
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type SetStateAction,
} from "react";
import {
  FREE_PARAMETER_SCOPE,
  LAUNCH_PARAMETER_TYPES,
  isFreeBinding,
  parameterKey,
  type FileLaunchBinding,
  type InputReferenceResolution,
  type LaunchBinding,
  type LaunchLocatorMode,
  type LaunchParameterType,
  type LocatorModeValues,
  type OutputExtraction,
} from "../../lib/launcher";
import type { ProjectLaunchMode } from "../../lib/projectFolder";
import {
  locatorDetails,
  locatorLabel,
  tokenRangeDetails,
} from "../../lib/programWorkspace";
import type { AutoTokenRange } from "../../lib/launcher";

export type InspectorTab = "parameter" | "launch";

const LOCATOR_MODES: Array<{
  value: LaunchLocatorMode;
  label: string;
}> = [
  { value: "auto", label: "自动" },
  { value: "fixedLength", label: "固定长度" },
  { value: "delimited", label: "分段" },
  { value: "startColumn", label: "起始列" },
  { value: "wholeLine", label: "整行" },
  { value: "multiLine", label: "多行" },
  { value: "indefiniteLine", label: "不定行" },
  { value: "jsonPath", label: "JSON 路径" },
  { value: "xmlPath", label: "XML 路径" },
  { value: "pattern", label: "模式匹配" },
];

const PARAMETER_TYPE_LABELS: Record<LaunchParameterType, string> = {
  text: "文本",
  number: "数值",
  boolean: "布尔",
  path: "路径",
};

interface InspectorPanelProps {
  argumentText: string;
  editingBinding: FileLaunchBinding | null;
  inputReferenceResolution: InputReferenceResolution;
  isCollapsed: boolean;
  launchMode: ProjectLaunchMode;
  locatorMode: LaunchLocatorMode;
  locatorModeValues: LocatorModeValues;
  program: string;
  selectedParameter: LaunchBinding | null;
  selectedParameterFileLabel: string;
  selectedParameterOutput: OutputExtraction | null;
  selectedParameterValueError: string | null;
  tab: InspectorTab;
  visibleAutoTokenRange: AutoTokenRange | null;
  workingDirectory: string;
  onApplyLocator: () => void;
  onBeginEditLocator: (binding: LaunchBinding) => void;
  onCancelLocator: () => void;
  onClose: () => void;
  onLocateBinding: (binding: LaunchBinding) => void;
  onRemoveBinding: (key: string) => void;
  setArgumentText: Dispatch<SetStateAction<string>>;
  setLaunchMode: Dispatch<SetStateAction<ProjectLaunchMode>>;
  setLocatorMode: Dispatch<SetStateAction<LaunchLocatorMode>>;
  setProgram: Dispatch<SetStateAction<string>>;
  setTab: Dispatch<SetStateAction<InspectorTab>>;
  setWorkingDirectory: Dispatch<SetStateAction<string>>;
  updateBinding: (
    key: string,
    changes: Partial<
      Pick<
        LaunchBinding,
        | "name"
        | "value"
        | "parameterType"
        | "inputReference"
        | "outputReference"
        | "defaultValue"
        | "unit"
        | "description"
      >
    >,
  ) => void;
  updateLocatorValue: <K extends keyof LocatorModeValues>(
    key: K,
    value: LocatorModeValues[K],
  ) => void;
}

function moveTabFocus(event: ReactKeyboardEvent<HTMLButtonElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabList = event.currentTarget.closest<HTMLElement>(
    '[role="tablist"]',
  );
  if (!tabList) return;
  const tabs = Array.from(
    tabList.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  );
  const currentIndex = tabs.indexOf(event.currentTarget);
  if (currentIndex < 0) return;
  event.preventDefault();
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : event.key === "ArrowRight"
          ? (currentIndex + 1) % tabs.length
          : (currentIndex - 1 + tabs.length) % tabs.length;
  tabs[nextIndex]?.focus();
  tabs[nextIndex]?.click();
}

function ParameterProperties({
  inputReferenceResolution,
  selectedParameter,
  selectedParameterFileLabel,
  selectedParameterOutput,
  selectedParameterValueError,
  onBeginEditLocator,
  onLocateBinding,
  onRemoveBinding,
  updateBinding,
}: Pick<
  InspectorPanelProps,
  | "inputReferenceResolution"
  | "selectedParameter"
  | "selectedParameterFileLabel"
  | "selectedParameterOutput"
  | "selectedParameterValueError"
  | "onBeginEditLocator"
  | "onLocateBinding"
  | "onRemoveBinding"
  | "updateBinding"
>) {
  if (!selectedParameter) {
    return (
      <div className="runner-parameter-property-empty">
        <strong>未选择参数</strong>
        <p>从左侧参数列表选择一项以查看和编辑属性。</p>
      </div>
    );
  }

  return (
    <>
      <div className="runner-property-heading">
        <div>
          <span>参数属性</span>
          <strong>{selectedParameter.name}</strong>
        </div>
        <span
          className={`runner-property-direction is-${selectedParameter.direction}`}
        >
          {selectedParameter.direction === "input" ? "输入" : "输出"}
        </span>
      </div>
      <div className="runner-property-form">
        <label className="runner-property-field">
          <span>名称</span>
          <input
            aria-label="参数名"
            onChange={(event) =>
              updateBinding(parameterKey(selectedParameter), {
                name: event.target.value,
              })
            }
            value={selectedParameter.name}
          />
        </label>
        <label className="runner-property-field">
          <span>类型</span>
          <select
            aria-label="参数类型"
            onChange={(event) =>
              updateBinding(parameterKey(selectedParameter), {
                parameterType: event.target.value as LaunchParameterType,
              })
            }
            value={selectedParameter.parameterType}
          >
            {LAUNCH_PARAMETER_TYPES.map((type) => (
              <option key={type} value={type}>
                {PARAMETER_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        {selectedParameter.direction === "input" && (
          <label className="runner-property-field is-wide">
            <span>引用主参数</span>
            <input
              aria-label="引用主参数"
              onChange={(event) =>
                updateBinding(parameterKey(selectedParameter), {
                  inputReference: event.target.value.trim() || undefined,
                })
              }
              placeholder="@文件名[In].参数名"
              value={selectedParameter.inputReference ?? ""}
            />
            <small className="runner-property-help">
              引用参数不直接赋值，运行时跟随主参数值。
            </small>
          </label>
        )}
        {isFreeBinding(selectedParameter) &&
          selectedParameter.direction === "output" && (
            <label className="runner-property-field is-wide">
              <span>引用绑定输出</span>
              <input
                aria-label="引用绑定输出"
                onChange={(event) =>
                  updateBinding(parameterKey(selectedParameter), {
                    outputReference: event.target.value.trim() || undefined,
                  })
                }
                placeholder="@文件名[Out].参数名"
                value={selectedParameter.outputReference ?? ""}
              />
              <small className="runner-property-help">
                引用输出优先；引用失败时可使用下方手动值。
              </small>
            </label>
          )}
        <label className="runner-property-field">
          <span>方向</span>
          <input
            aria-label="参数方向"
            disabled
            value={selectedParameter.direction === "input" ? "输入" : "输出"}
          />
        </label>
        <label className="runner-property-field">
          <span>单位</span>
          <input
            aria-label="参数单位"
            onChange={(event) =>
              updateBinding(parameterKey(selectedParameter), {
                unit: event.target.value,
              })
            }
            placeholder="例如 MPa"
            value={selectedParameter.unit}
          />
        </label>
        <label className="runner-property-field is-wide">
          <span>默认值</span>
          <textarea
            aria-label="参数默认值"
            onChange={(event) =>
              updateBinding(parameterKey(selectedParameter), {
                defaultValue: event.target.value,
              })
            }
            rows={2}
            value={selectedParameter.defaultValue}
          />
        </label>
        <label className="runner-property-field is-wide">
          <span>
            {selectedParameter.direction === "input" ? "当前值" : "输出值"}
          </span>
          {selectedParameter.direction === "input" ? (
            <>
              {selectedParameter.inputReference ? (
                <div className="runner-output-value runner-property-readonly">
                  <span>
                    {inputReferenceResolution.roots.get(
                      parameterKey(selectedParameter),
                    )?.value ?? "引用无效"}
                  </span>
                </div>
              ) : (
                <textarea
                  aria-invalid={
                    selectedParameterValueError ? "true" : undefined
                  }
                  aria-label="当前输入值"
                  className={`runner-binding-value${
                    selectedParameterValueError ? " is-invalid" : ""
                  }`}
                  onChange={(event) =>
                    updateBinding(parameterKey(selectedParameter), {
                      value: event.target.value,
                    })
                  }
                  rows={2}
                  value={selectedParameter.value}
                />
              )}
              {selectedParameterValueError && (
                <small className="runner-property-error">
                  {selectedParameterValueError}
                </small>
              )}
            </>
          ) : isFreeBinding(selectedParameter) ? (
            <>
              <textarea
                aria-invalid={
                  selectedParameterValueError ? "true" : undefined
                }
                aria-label="手动输出值"
                className={`runner-binding-value${
                  selectedParameterValueError ? " is-invalid" : ""
                }`}
                onChange={(event) =>
                  updateBinding(parameterKey(selectedParameter), {
                    value: event.target.value,
                  })
                }
                placeholder="可选；留空时仅使用引用输出"
                rows={2}
                value={selectedParameter.value}
              />
              <small className="runner-property-help">
                本次输出：
                {selectedParameterOutput?.value ?? "尚未运行"}
                {selectedParameterOutput?.error
                  ? `（${selectedParameterOutput.error}）`
                  : ""}
              </small>
            </>
          ) : (
            <div
              className="runner-output-value runner-property-readonly"
              title={selectedParameterOutput?.error ?? undefined}
            >
              <span>{selectedParameterOutput?.value ?? "等待提取"}</span>
            </div>
          )}
        </label>
        <label className="runner-property-field is-wide">
          <span>文件</span>
          <input
            aria-label="参数文件"
            readOnly
            title={selectedParameterFileLabel}
            value={selectedParameterFileLabel}
          />
        </label>
        <div className="runner-property-field is-wide">
          <span>定位</span>
          <div
            aria-label="参数定位信息"
            className="runner-property-locator-summary"
          >
            <div className="runner-property-locator-summary-heading">
              <span
                className={`runner-binding-meta${
                  selectedParameter.locatorInvalid ? " is-invalid" : ""
                }`}
                title={locatorLabel(selectedParameter)}
              >
                {locatorLabel(selectedParameter)}
              </span>
              <button
                aria-label={`修改 ${selectedParameter.name} 定位`}
                disabled={isFreeBinding(selectedParameter)}
                onClick={() => onBeginEditLocator(selectedParameter)}
                type="button"
              >
                修改定位
              </button>
            </div>
            <dl className="runner-property-locator-details">
              {isFreeBinding(selectedParameter) ? (
                <div>
                  <dt>作用域</dt>
                  <dd>不关联文件</dd>
                </div>
              ) : (
                locatorDetails(selectedParameter.locator).map((detail) => (
                  <div key={detail.label}>
                    <dt>{detail.label}</dt>
                    <dd>{detail.value}</dd>
                  </div>
                ))
              )}
            </dl>
          </div>
        </div>
        <label className="runner-property-field is-wide">
          <span>备注</span>
          <textarea
            aria-label="参数备注"
            onChange={(event) =>
              updateBinding(parameterKey(selectedParameter), {
                description: event.target.value,
              })
            }
            placeholder="添加参数说明"
            rows={2}
            value={selectedParameter.description}
          />
        </label>
      </div>
      <div className="runner-property-actions">
        {selectedParameter.direction === "input" && (
          <button
            aria-label={`将 ${selectedParameter.name} 恢复默认值`}
            disabled={
              selectedParameter.value === selectedParameter.defaultValue
            }
            onClick={() =>
              updateBinding(parameterKey(selectedParameter), {
                value: selectedParameter.defaultValue,
              })
            }
            type="button"
          >
            恢复默认值
          </button>
        )}
        <button
          aria-label={`定位 ${selectedParameter.name}`}
          onClick={() => onLocateBinding(selectedParameter)}
          type="button"
        >
          定位原文
        </button>
        <button
          aria-label={`删除 ${selectedParameter.name}`}
          className="is-danger"
          onClick={() => onRemoveBinding(parameterKey(selectedParameter))}
          type="button"
        >
          删除参数
        </button>
      </div>
    </>
  );
}

function LocatorEditor({
  editingBinding,
  locatorMode,
  locatorModeValues,
  visibleAutoTokenRange,
  onApplyLocator,
  onCancelLocator,
  setLocatorMode,
  updateLocatorValue,
}: Pick<
  InspectorPanelProps,
  | "editingBinding"
  | "locatorMode"
  | "locatorModeValues"
  | "visibleAutoTokenRange"
  | "onApplyLocator"
  | "onCancelLocator"
  | "setLocatorMode"
  | "updateLocatorValue"
>) {
  return (
    <div className="runner-locator-mode is-editing">
      <div className="runner-locator-heading">
        <div>
          <span>定位规则</span>
          <strong>识别模式</strong>
        </div>
        <small>正在修改：{editingBinding?.name}</small>
      </div>
      <label className="runner-field">
        <select
          aria-label="识别模式"
          onChange={(event) =>
            setLocatorMode(event.target.value as LaunchLocatorMode)
          }
          value={locatorMode}
        >
          {LOCATOR_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>
      </label>
      {(locatorMode === "auto" ||
        locatorMode === "fixedLength" ||
        locatorMode === "startColumn" ||
        locatorMode === "wholeLine" ||
        locatorMode === "multiLine" ||
        locatorMode === "delimited") && (
        <div className="runner-mode-grid">
          <label className="runner-field">
            <span>起始行</span>
            <input
              min="1"
              onChange={(event) =>
                updateLocatorValue(
                  "startRowIndex",
                  Number(event.target.value),
                )
              }
              type="number"
              value={locatorModeValues.startRowIndex ?? 1}
            />
          </label>
          {(locatorMode === "auto" ||
            locatorMode === "fixedLength" ||
            locatorMode === "startColumn") && (
            <label className="runner-field">
              <span>起始列</span>
              <input
                min="0"
                onChange={(event) =>
                  updateLocatorValue(
                    "startColumnIndex",
                    Number(event.target.value),
                  )
                }
                type="number"
                value={locatorModeValues.startColumnIndex ?? 0}
              />
            </label>
          )}
          {(locatorMode === "auto" ||
            locatorMode === "fixedLength" ||
            locatorMode === "multiLine") && (
            <label className="runner-field">
              <span>结束行</span>
              <input
                min="1"
                onChange={(event) =>
                  updateLocatorValue(
                    "endRowIndex",
                    Number(event.target.value),
                  )
                }
                type="number"
                value={locatorModeValues.endRowIndex ?? 1}
              />
            </label>
          )}
          {(locatorMode === "auto" || locatorMode === "fixedLength") && (
            <label className="runner-field">
              <span>结束列</span>
              <input
                min="0"
                onChange={(event) =>
                  updateLocatorValue(
                    "endColumnIndex",
                    Number(event.target.value),
                  )
                }
                type="number"
                value={locatorModeValues.endColumnIndex ?? 0}
              />
            </label>
          )}
          {locatorMode === "delimited" && (
            <>
              <label className="runner-field">
                <span>分隔符</span>
                <input
                  onChange={(event) =>
                    updateLocatorValue("separator", event.target.value)
                  }
                  placeholder="例如 \t 或 ,"
                  value={locatorModeValues.separator ?? ""}
                />
              </label>
              <label className="runner-field">
                <span>分段序号</span>
                <input
                  min="0"
                  onChange={(event) =>
                    updateLocatorValue(
                      "fieldIndex",
                      Number(event.target.value),
                    )
                  }
                  type="number"
                  value={locatorModeValues.fieldIndex ?? 0}
                />
              </label>
            </>
          )}
        </div>
      )}
      {locatorMode === "indefiniteLine" && (
        <div className="runner-mode-grid">
          <label className="runner-field">
            <span>起始标记</span>
            <input
              onChange={(event) =>
                updateLocatorValue("startMarker", event.target.value)
              }
              placeholder="例如 RESULT_BEGIN"
              value={locatorModeValues.startMarker ?? ""}
            />
          </label>
          <label className="runner-field">
            <span>结束标记</span>
            <input
              onChange={(event) =>
                updateLocatorValue("endMarker", event.target.value)
              }
              placeholder="例如 RESULT_END"
              value={locatorModeValues.endMarker ?? ""}
            />
          </label>
        </div>
      )}
      {locatorMode === "jsonPath" && (
        <label className="runner-field">
          <span>JSON 路径</span>
          <input
            onChange={(event) =>
              updateLocatorValue("jsonPath", event.target.value)
            }
            placeholder="$.results[0].maximum"
            value={locatorModeValues.jsonPath ?? "$"}
          />
        </label>
      )}
      {locatorMode === "xmlPath" && (
        <label className="runner-field">
          <span>XML 路径</span>
          <input
            onChange={(event) =>
              updateLocatorValue("xmlPath", event.target.value)
            }
            placeholder="/results/stress[1]/@maximum"
            value={locatorModeValues.xmlPath ?? ""}
          />
        </label>
      )}
      {locatorMode === "pattern" && (
        <div className="runner-mode-grid">
          <label className="runner-field runner-mode-wide">
            <span>正则表达式</span>
            <input
              onChange={(event) =>
                updateLocatorValue("pattern", event.target.value)
              }
              placeholder="maximum\\s*=\\s*([\\d.e+-]+)"
              value={locatorModeValues.pattern ?? ""}
            />
          </label>
          <label className="runner-field">
            <span>标志</span>
            <input
              onChange={(event) =>
                updateLocatorValue("flags", event.target.value)
              }
              placeholder="i"
              value={locatorModeValues.flags ?? ""}
            />
          </label>
          <label className="runner-field">
            <span>捕获组</span>
            <input
              min="0"
              onChange={(event) =>
                updateLocatorValue(
                  "captureGroup",
                  Number(event.target.value),
                )
              }
              type="number"
              value={locatorModeValues.captureGroup ?? 0}
            />
          </label>
        </div>
      )}
      {(locatorMode === "indefiniteLine" || locatorMode === "pattern") && (
        <label className="runner-field">
          <span>出现序号</span>
          <input
            min="0"
            onChange={(event) =>
              updateLocatorValue("occurrence", Number(event.target.value))
            }
            type="number"
            value={locatorModeValues.occurrence ?? 0}
          />
        </label>
      )}
      <p className="runner-mode-hint">
        {locatorMode === "auto"
          ? "在编辑器拖选新内容会自动更新起始行列；单行局部选区还会保存特殊字符 Token 相对边界。"
          : "按上方模式参数定位；也可以在编辑器拖选后切回自动模式。"}
      </p>
      {locatorMode === "auto" && (
        <div className="runner-token-preview" aria-label="自动定位 Token 预览">
          <div className="runner-token-preview-heading">
            <span>{visibleAutoTokenRange ? "当前参数" : "Token 预览"}</span>
            <strong>
              {visibleAutoTokenRange
                ? "特殊字符相对边界"
                : "等待单行选区"}
            </strong>
          </div>
          {visibleAutoTokenRange ? (
            <dl className="runner-property-locator-details">
              {tokenRangeDetails(visibleAutoTokenRange).map((detail) => (
                <div key={detail.label}>
                  <dt>{detail.label}</dt>
                  <dd>{detail.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <small>
              选择单行内容后显示 Token 边界；跨行选区继续使用固定行列。
            </small>
          )}
        </div>
      )}
      <div className="runner-locator-edit-actions">
        <button
          className="runner-locator-apply"
          onClick={onApplyLocator}
          type="button"
        >
          应用定位
        </button>
        <button
          className="runner-locator-cancel"
          onClick={onCancelLocator}
          type="button"
        >
          取消
        </button>
      </div>
    </div>
  );
}

export function InspectorPanel(props: InspectorPanelProps) {
  const heading =
    props.tab === "parameter"
      ? props.editingBinding
        ? "修改定位"
        : "参数属性"
      : "启动配置";
  return (
    <aside
      className={`runner-controls${props.isCollapsed ? " is-collapsed" : ""}`}
      aria-label="检查器"
    >
      <div className="runner-panel-heading">
        <div>
          <span>检查器</span>
          <strong>{heading}</strong>
        </div>
        <button
          aria-label="关闭检查器"
          className="runner-icon-button"
          onClick={props.onClose}
          type="button"
        >
          ×
        </button>
      </div>
      <div
        aria-label="检查器视图"
        className="runner-inspector-tabs"
        role="tablist"
      >
        <button
          aria-selected={props.tab === "parameter"}
          className={props.tab === "parameter" ? "is-active" : ""}
          onClick={() => props.setTab("parameter")}
          onKeyDown={moveTabFocus}
          role="tab"
          tabIndex={props.tab === "parameter" ? 0 : -1}
          type="button"
        >
          参数属性
        </button>
        <button
          aria-selected={props.tab === "launch"}
          className={props.tab === "launch" ? "is-active" : ""}
          onClick={() => props.setTab("launch")}
          onKeyDown={moveTabFocus}
          role="tab"
          tabIndex={props.tab === "launch" ? 0 : -1}
          type="button"
        >
          启动配置
        </button>
      </div>

      {props.tab === "parameter" && (
        <section className="runner-parameter-properties">
          {props.editingBinding ? (
            <LocatorEditor {...props} />
          ) : (
            <ParameterProperties {...props} />
          )}
        </section>
      )}

      {props.tab === "launch" && (
        <div className="runner-inspector-scroll">
          <label className="runner-field">
            <span>启动方式</span>
            <select
              aria-label="启动方式"
              onChange={(event) =>
                props.setLaunchMode(
                  event.target.value as ProjectLaunchMode,
                )
              }
              value={props.launchMode}
            >
              <option value="direct">直接启动程序</option>
              <option value="shell">Shell 命令</option>
            </select>
          </label>
          <label className="runner-field">
            <span>程序路径</span>
            <input
              onChange={(event) => props.setProgram(event.target.value)}
              placeholder="例如 C:\Tools\solver.exe"
              value={props.program}
            />
          </label>
          <label className="runner-field">
            <span>参数</span>
            <textarea
              onChange={(event) => props.setArgumentText(event.target.value)}
              placeholder={'--input "case.ccl" --param @CFX1[In].输入参数'}
              rows={3}
              value={props.argumentText}
            />
            <small>参数中的 @文件名[In].参数名 会替换为绑定值。</small>
          </label>
          <label className="runner-field">
            <span>工作目录</span>
            <input
              onChange={(event) =>
                props.setWorkingDirectory(event.target.value)
              }
              placeholder="files"
              value={props.workingDirectory}
            />
            <small>相对路径以工程目录或运行工作区为基准。</small>
          </label>
        </div>
      )}
    </aside>
  );
}
