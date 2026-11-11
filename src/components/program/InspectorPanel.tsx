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
  referenceOptionsForBinding,
  type FileLaunchBinding,
  type LaunchBinding,
  type LaunchLocatorMode,
  type LaunchParameterType,
  type LocatorModeValues,
} from "../../lib/launcher";
import type { ProjectLaunchMode } from "../../lib/projectFolder";
import {
  locatorDetails,
  locatorLabel,
} from "../../lib/programWorkspace";
import { LocatorEditor } from "./locator-editor/LocatorEditor";

export type InspectorTab = "parameter" | "launch";

const PARAMETER_TYPE_LABELS: Record<LaunchParameterType, string> = {
  text: "文本",
  number: "数值",
  boolean: "布尔",
  path: "路径",
};

interface InspectorPanelProps {
  argumentText: string;
  bindings: LaunchBinding[];
  editingBinding: FileLaunchBinding | null;
  isCollapsed: boolean;
  launchMode: ProjectLaunchMode;
  locatorMode: LaunchLocatorMode;
  locatorModeValues: LocatorModeValues;
  program: string;
  selectedParameter: LaunchBinding | null;
  tab: InspectorTab;
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
        | "module"
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
  bindings,
  selectedParameter,
  onBeginEditLocator,
  onLocateBinding,
  onRemoveBinding,
  updateBinding,
}: Pick<
  InspectorPanelProps,
  | "bindings"
  | "selectedParameter"
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

  const referenceOptions = referenceOptionsForBinding(
    bindings,
    selectedParameter,
  );

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
          <span>模块</span>
          <input
            aria-label="参数模块"
            onChange={(event) =>
              updateBinding(parameterKey(selectedParameter), {
                module: event.target.value.trim() || undefined,
              })
            }
            placeholder="例如 CFX1[In]"
            value={selectedParameter.module ?? ""}
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
              list="input-reference-options"
              onChange={(event) =>
                updateBinding(parameterKey(selectedParameter), {
                  inputReference: event.target.value.trim() || undefined,
                })
              }
              placeholder="@文件主名[In].参数名"
              value={selectedParameter.inputReference ?? ""}
            />
            <datalist id="input-reference-options">
              {referenceOptions.inputs.map((option) => (
                <option
                  key={option.value}
                  label={option.label}
                  value={option.value}
                />
              ))}
            </datalist>
          </label>
        )}
        {isFreeBinding(selectedParameter) &&
          selectedParameter.direction === "output" && (
            <label className="runner-property-field is-wide">
              <span>引用绑定输出</span>
              <input
                aria-label="引用绑定输出"
                list="output-reference-options"
                onChange={(event) =>
                  updateBinding(parameterKey(selectedParameter), {
                    outputReference: event.target.value.trim() || undefined,
                  })
                }
                placeholder="@文件主名[Out].参数名"
                value={selectedParameter.outputReference ?? ""}
              />
              <datalist id="output-reference-options">
                {referenceOptions.outputs.map((option) => (
                  <option
                    key={option.value}
                    label={option.label}
                    value={option.value}
                  />
                ))}
              </datalist>
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
          </label>
        </div>
      )}
    </aside>
  );
}
