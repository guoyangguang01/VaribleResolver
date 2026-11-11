import type {
  ChangeEvent,
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
  SetStateAction,
} from "react";
import {
  FREE_PARAMETER_SCOPE,
  parameterKey,
  type LaunchBinding,
  type LaunchBindingDirection,
  type LaunchFile,
  type OutputExtraction,
} from "../../lib/launcher";
import { locatorLabel } from "../../lib/programWorkspace";
import { AddIcon, FolderIcon, ReferenceIcon } from "./ProgramIcons";

export interface ParameterFileGroup {
  path: string;
  name: string;
  inputs: LaunchBinding[];
  outputs: LaunchBinding[];
}

interface ParameterSidebarProps {
  activeFilePath: string | null;
  bindingsCount: number;
  collapsedTreeKeys: Set<string>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  files: LaunchFile[];
  isCollapsed: boolean;
  locatedParameterKey: string | null;
  outputsByParameterKey: Map<string, OutputExtraction>;
  parameterDirection: "all" | LaunchBindingDirection;
  parameterFileGroups: ParameterFileGroup[];
  parameterQuery: string;
  selectedParameterKey: string | null;
  tab: "files" | "parameters";
  visibleBindingsCount: number;
  onAddFreeParameter: (direction: LaunchBindingDirection) => void;
  onFileInput: (event: ChangeEvent<HTMLInputElement>) => void;
  onLoadExample: () => void;
  onLocateBinding: (binding: LaunchBinding) => void;
  onOpenFiles: () => void;
  onRemoveFile: (filePath: string) => void;
  onSelectFile: (filePath: string) => void;
  setCollapsedTreeKeys: Dispatch<SetStateAction<Set<string>>>;
  setParameterDirection: Dispatch<
    SetStateAction<"all" | LaunchBindingDirection>
  >;
  setParameterQuery: Dispatch<SetStateAction<string>>;
  setTab: Dispatch<SetStateAction<"files" | "parameters">>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function moveTreeFocus(event: ReactKeyboardEvent<HTMLButtonElement>) {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const tree = event.currentTarget.closest<HTMLElement>(
    ".runner-sidebar-parameter-tree",
  );
  if (!tree) return;
  const items = Array.from(
    tree.querySelectorAll<HTMLButtonElement>("button"),
  ).filter((item) => item.offsetParent !== null);
  const currentIndex = items.indexOf(event.currentTarget);
  if (currentIndex < 0) return;
  event.preventDefault();
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? Math.min(items.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1);
  items[nextIndex]?.focus();
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

export function ParameterSidebar({
  activeFilePath,
  bindingsCount,
  collapsedTreeKeys,
  fileInputRef,
  files,
  isCollapsed,
  locatedParameterKey,
  outputsByParameterKey,
  parameterDirection,
  parameterFileGroups,
  parameterQuery,
  selectedParameterKey,
  tab,
  visibleBindingsCount,
  onAddFreeParameter,
  onFileInput,
  onLoadExample,
  onLocateBinding,
  onOpenFiles,
  onRemoveFile,
  onSelectFile,
  setCollapsedTreeKeys,
  setParameterDirection,
  setParameterQuery,
  setTab,
}: ParameterSidebarProps) {
  const toggleGroup = (key: string) => {
    setCollapsedTreeKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <aside
      className={`runner-files${isCollapsed ? " is-collapsed" : ""}`}
      aria-label="资源与参数"
    >
      <div className="runner-panel-heading">
        <div>
          <span>{tab === "files" ? "资源" : "参数"}</span>
          <strong>
            {tab === "files"
              ? `${files.length} 个文件`
              : `${visibleBindingsCount} 个参数`}
          </strong>
        </div>
        {tab === "files" && (
          <button
            aria-label="导入文件"
            className="runner-icon-button"
            onClick={onOpenFiles}
            type="button"
          >
            <AddIcon />
          </button>
        )}
      </div>
      <div
        aria-label="左侧栏视图"
        className="runner-sidebar-tabs"
        role="tablist"
      >
        <button
          aria-selected={tab === "files"}
          className={tab === "files" ? "is-active" : ""}
          onClick={() => setTab("files")}
          onKeyDown={moveTabFocus}
          role="tab"
          tabIndex={tab === "files" ? 0 : -1}
          type="button"
        >
          资源
        </button>
        <button
          aria-selected={tab === "parameters"}
          className={tab === "parameters" ? "is-active" : ""}
          onClick={() => setTab("parameters")}
          onKeyDown={moveTabFocus}
          role="tab"
          tabIndex={tab === "parameters" ? 0 : -1}
          type="button"
        >
          参数
          <small>{bindingsCount}</small>
        </button>
      </div>
      <input
        className="file-input"
        multiple
        onChange={onFileInput}
        ref={fileInputRef}
        type="file"
      />
      {tab === "files" ? (
        <>
          <button
            className="runner-load-example"
            onClick={onLoadExample}
            type="button"
          >
            打开默认测试工程
          </button>
          <div className="runner-file-list">
            {files.length === 0 && (
              <p className="runner-empty-small">
                还没有文件。可一次导入多个文本文件。
              </p>
            )}
            {files.map((file) => (
              <div
                className={`runner-file-item${
                  file.path === activeFilePath ? " is-active" : ""
                }`}
                key={file.path}
              >
                <button
                  className="runner-file-select"
                  onClick={() => onSelectFile(file.path)}
                  type="button"
                >
                  <span>
                    {file.name.slice(file.name.lastIndexOf(".") + 1) || "TXT"}
                  </span>
                  <strong title={file.path}>{file.path}</strong>
                  <small>{formatBytes(file.size)}</small>
                </button>
                <div className="runner-file-actions">
                  <button
                    aria-label={`移除 ${file.name}`}
                    onClick={() => onRemoveFile(file.path)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="runner-parameter-sidebar">
          <div className="runner-parameter-sidebar-tools">
            <input
              aria-label="搜索参数"
              onChange={(event) => setParameterQuery(event.target.value)}
              placeholder="搜索参数、类型或备注"
              type="search"
              value={parameterQuery}
            />
            <select
              aria-label="参数方向筛选"
              onChange={(event) =>
                setParameterDirection(
                  event.target.value as "all" | LaunchBindingDirection,
                )
              }
              value={parameterDirection}
            >
              <option value="all">全部方向</option>
              <option value="input">仅输入</option>
              <option value="output">仅输出</option>
            </select>
            <details className="runner-free-parameter-picker">
              <summary className="runner-free-parameter-button">
                添加自由参数
              </summary>
              <div className="runner-free-parameter-menu" role="menu">
                <button
                  onClick={(event) => {
                    onAddFreeParameter("input");
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                  }}
                  role="menuitem"
                  type="button"
                >
                  自由输入
                </button>
                <button
                  onClick={(event) => {
                    onAddFreeParameter("output");
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                  }}
                  role="menuitem"
                  type="button"
                >
                  自由输出
                </button>
              </div>
            </details>
          </div>
          <div
            aria-label="参数列表"
            className="runner-parameter-tree-body runner-sidebar-parameter-tree"
            role="tree"
          >
            {parameterFileGroups.length === 0 && (
              <p className="runner-parameter-empty">
                没有符合条件的参数。调整筛选条件或在文件中新增输入/输出。
              </p>
            )}
            {parameterFileGroups.map((group) => {
              const fileKey = `file:${group.path}`;
              const fileCollapsed = collapsedTreeKeys.has(fileKey);
              return (
                <div
                  aria-expanded={!fileCollapsed}
                  className="runner-parameter-file-group"
                  key={group.path}
                  role="treeitem"
                >
                  <button
                    aria-expanded={!fileCollapsed}
                    className="runner-parameter-file-node"
                    onClick={() => toggleGroup(fileKey)}
                    onKeyDown={(event) => {
                      if (
                        (event.key === "ArrowLeft" && !fileCollapsed) ||
                        (event.key === "ArrowRight" && fileCollapsed)
                      ) {
                        event.preventDefault();
                        toggleGroup(fileKey);
                        return;
                      }
                      moveTreeFocus(event);
                    }}
                    title={group.path}
                    type="button"
                  >
                    <span className="tree-chevron">
                      {fileCollapsed ? "›" : "⌄"}
                    </span>
                    <FolderIcon />
                    <strong>{group.name}</strong>
                    <small>
                      IN {group.inputs.length} · OUT {group.outputs.length}
                    </small>
                  </button>
                  {!fileCollapsed && (
                    <div
                      className="runner-parameter-direction-groups"
                      role="group"
                    >
                      {(["input", "output"] as const).map((direction) => {
                        const items =
                          direction === "input" ? group.inputs : group.outputs;
                        if (items.length === 0) return null;
                        const directionKey = `${direction}:${group.path}`;
                        const directionCollapsed =
                          collapsedTreeKeys.has(directionKey);
                        return (
                          <div
                            aria-expanded={!directionCollapsed}
                            className="runner-parameter-direction-group"
                            key={direction}
                            role="treeitem"
                          >
                            <button
                              aria-expanded={!directionCollapsed}
                              className={`runner-parameter-direction-node is-${direction}`}
                              onClick={() => toggleGroup(directionKey)}
                              onKeyDown={(event) => {
                                if (
                                  (event.key === "ArrowLeft" &&
                                    !directionCollapsed) ||
                                  (event.key === "ArrowRight" &&
                                    directionCollapsed)
                                ) {
                                  event.preventDefault();
                                  toggleGroup(directionKey);
                                  return;
                                }
                                moveTreeFocus(event);
                              }}
                              type="button"
                            >
                              <span className="tree-chevron">
                                {directionCollapsed ? "›" : "⌄"}
                              </span>
                              <span className="tree-direction-mark">
                                {direction === "input" ? "IN" : "OUT"}
                              </span>
                              <strong>
                                {direction === "input" ? "输入" : "输出"}
                              </strong>
                              <small>{items.length}</small>
                            </button>
                            {!directionCollapsed && (
                              <div className="runner-parameter-items" role="group">
                                {items.map((binding) => {
                                  const key = parameterKey(binding);
                                  const parameterOutput =
                                    outputsByParameterKey.get(key);
                                  return (
                                    <button
                                      aria-label={`${
                                        binding.direction === "input"
                                          ? "输入"
                                          : "输出"
                                      }参数 ${binding.name}${
                                        binding.inputReference
                                          ? "，引用参数"
                                          : ""
                                      }`}
                                      aria-selected={key === selectedParameterKey}
                                      className={`runner-binding is-${binding.direction}${
                                        parameterOutput?.error ? " has-error" : ""
                                      }${
                                        binding.locatorInvalid
                                          ? " has-locator-error"
                                          : ""
                                      }${
                                        key === locatedParameterKey
                                          ? " is-located"
                                          : ""
                                      }${
                                        key === selectedParameterKey
                                          ? " is-selected"
                                          : ""
                                      }`}
                                      data-parameter-key={key}
                                      key={key}
                                      onClick={() => onLocateBinding(binding)}
                                      onKeyDown={moveTreeFocus}
                                      role="treeitem"
                                      title={`${
                                        binding.scope === "free"
                                          ? FREE_PARAMETER_SCOPE
                                          : binding.filePath
                                      }\n${locatorLabel(binding)}${
                                        binding.inputReference
                                          ? `\n引用：${binding.inputReference}`
                                          : ""
                                      }`}
                                      type="button"
                                    >
                                      <span className="tree-parameter-glyph">
                                        ↳
                                      </span>
                                      <span className="runner-parameter-name">
                                        {binding.name}
                                      </span>
                                      {binding.inputReference && (
                                        <span
                                          className="runner-parameter-reference"
                                          title={`引用 ${binding.inputReference}`}
                                        >
                                          <ReferenceIcon />
                                        </span>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
