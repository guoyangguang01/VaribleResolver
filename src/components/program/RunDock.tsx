import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { OutputExtraction } from "../../lib/launcher";
import type { EffectiveInputValue } from "../../lib/projectExecution";
import { CopyIcon } from "./ProgramIcons";

interface RunDockProps {
  collapsed: boolean;
  commandPreview: string;
  isRunning: boolean;
  outputs: OutputExtraction[];
  runtimeResult: DesktopRunResult | null;
  runtimeInputs: EffectiveInputValue[];
  onCopyCommand: () => void;
  onResetSize: () => void;
  onResizeKey: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onToggleCollapsed: () => void;
}

export function RunDock({
  collapsed,
  commandPreview,
  isRunning,
  outputs,
  runtimeResult,
  runtimeInputs,
  onCopyCommand,
  onResetSize,
  onResizeKey,
  onResizeStart,
  onToggleCollapsed,
}: RunDockProps) {
  return (
    <>
      <div
        aria-label="调整底部面板高度"
        aria-orientation="horizontal"
        className="dock-resizer"
        onDoubleClick={onResetSize}
        onKeyDown={onResizeKey}
        onPointerDown={onResizeStart}
        role="separator"
        tabIndex={0}
      />

      <div className="dock-tabs">
        <div className="dock-title">
          <span className={`dock-run-state${isRunning ? " is-running" : ""}`} />
          <strong>运行输出</strong>
          <small>
            {isRunning
              ? "程序运行中"
              : runtimeResult?.status === "completed"
                ? "上次运行完成"
                : runtimeResult
                  ? "上次运行失败"
                  : "等待运行"}
          </small>
        </div>
        <button
          aria-label={collapsed ? "展开底部面板" : "收起底部面板"}
          className="dock-collapse-button"
          onClick={onToggleCollapsed}
          title={collapsed ? "展开底部面板" : "收起底部面板"}
          type="button"
        >
          {collapsed ? "⌃" : "⌄"}
        </button>
      </div>

      <div
        className={`runner-command-area${
          collapsed ? " is-panel-hidden" : ""
        }`}
      >
        <div className="runner-command-heading">
          <div>
            <span>命令预览</span>
            <strong>启动命令</strong>
          </div>
        </div>
        <pre aria-live="polite">
          {commandPreview ||
            "填写程序路径后，这里会生成可复制的启动命令。"}
        </pre>
        <div className="runner-command-actions">
          <button
            disabled={!commandPreview || commandPreview.startsWith("参数错误")}
            onClick={onCopyCommand}
            type="button"
          >
            <CopyIcon />
            复制命令
          </button>
        </div>
        {runtimeResult && (
          <div className={`runner-runtime is-${runtimeResult.status}`}>
            <div className="runner-runtime-heading">
              <strong>
                {runtimeResult.status === "completed" ? "运行完成" : "运行失败"}
              </strong>
              <span>
                退出码 {runtimeResult.exitCode ?? "—"} ·{" "}
                {(runtimeResult.durationMs / 1000).toFixed(2)} s
              </span>
            </div>
            <div className="runner-runtime-streams">
              <pre>{runtimeResult.stdout || "（无标准输出）"}</pre>
              <pre className="is-error">
                {runtimeResult.stderr ||
                  runtimeResult.error ||
                  "（无标准错误）"}
              </pre>
            </div>
            <div
              aria-label="本次运行参数"
              className="runner-runtime-parameters"
            >
              <div className="runner-runtime-parameters-heading">
                <strong>本次运行参数</strong>
                <span>
                  {runtimeInputs.length} 个输入 · {outputs.length} 个输出
                </span>
              </div>
              <ul>
                {runtimeInputs.map((input) => (
                  <li key={`input:${input.parameterKey}`}>
                    <span className="runner-runtime-parameter-direction">
                      输入
                    </span>
                    <strong>{input.name}</strong>
                    <small>{input.filePath ?? "自由参数"}</small>
                    <code>{input.effectiveValue || "（空）"}</code>
                  </li>
                ))}
                {outputs.map((output) => (
                  <li
                    className={output.error ? "is-invalid" : ""}
                    key={`output:${output.parameterKey}`}
                  >
                    <span className="runner-runtime-parameter-direction">
                      输出
                    </span>
                    <strong>{output.name}</strong>
                    <small>
                      {output.error ??
                        output.filePath ??
                        output.fileName}
                    </small>
                    <code>{output.value ?? "（空）"}</code>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {!runtimeResult && (
          <div className="runner-run-empty">
            <span className={isRunning ? "is-running" : ""} />
            <strong>{isRunning ? "程序运行中" : "等待运行"}</strong>
          </div>
        )}
      </div>
    </>
  );
}
