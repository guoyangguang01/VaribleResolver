import type { CSSProperties } from "react";
import { DEFAULT_LAYOUT } from "../hooks/useWorkbenchLayout";
import { useProgramWorkspace } from "../hooks/useProgramWorkspace";
import { ParameterSidebar } from "./program/ParameterSidebar";
import { ProgramToolbar } from "./program/ProgramToolbar";
import { InspectorPanel, type InspectorTab } from "./program/InspectorPanel";
import { RunDock } from "./program/RunDock";
import { SourceWorkspace } from "./program/SourceWorkspace";
import { isFileBinding, parameterKey } from "../lib/launcher";

export default function ProgramLauncher() {
  const {
    layout,
    setLayout,
    beginResize,
    resizeWithKeyboard,
    themePreference,
    resolvedTheme,
    themeMenuRef,
    changeTheme,
    files,
    projectName,
    setProjectName,
    projectPath,
    activeFilePath,
    setActiveFilePath,
    selection,
    setSelection,
    bindings,
    program,
    setProgram,
    argumentText,
    setArgumentText,
    workingDirectory,
    setWorkingDirectory,
    launchMode,
    setLaunchMode,
    locatorMode,
    setLocatorMode,
    editingBindingId,
    locatorModeValues,
    parameterQuery,
    setParameterQuery,
    parameterDirection,
    setParameterDirection,
    collapsedTreeKeys,
    setCollapsedTreeKeys,
    locatedBindingId,
    selectedParameterId,
    notice,
    setNotice,
    isRunning,
    runtimeResult,
    editorContextMenu,
    setEditorContextMenu,
    leftSidebarTab,
    setLeftSidebarTab,
    inspectorTab,
    setInspectorTab,
    inspectorDrawerOpen,
    setInspectorDrawerOpen,
    confirmOpenProject,
    setConfirmOpenProject,
    fileInputRef,
    editorRef,
    editorContextMenuRef,
    isDirty,
    activeFile,
    selectedText,
    editorContextText,
    outputsByParameterKey,
    editingBinding,
    visibleAutoTokenRange,
    visibleBindings,
    parameterFileGroups,
    selectedParameter,
    selectedParameterFileLabel,
    selectedParameterOutput,
    inputReferenceResolution,
    selectedParameterValueError,
    commandPreview,
    selectedBinding,
    editorHighlightRanges,
    updateFile,
    openFiles,
    loadFa1Example,
    saveProjectFolder,
    requestOpenProject,
    removeFile,
    moveFile,
    addBinding,
    handleEditorContextMenu,
    addFreeParameter,
    updateBinding,
    removeBinding,
    locateBinding,
    beginEditLocator,
    cancelLocatorEdit,
    applyLocatorEdit,
    handleEditorDoubleClick,
    runProgram,
    copyCommand,
    handleFileInput,
    updateLocatorValue,
    openProjectFolder,
  } = useProgramWorkspace();

  const rootStyle = {
    "--explorer-width": layout.leftCollapsed ? "44px" : `${layout.leftWidth}px`,
    "--inspector-width": layout.rightCollapsed
      ? "0px"
      : `${layout.rightWidth}px`,
    "--dock-height": layout.dockCollapsed ? "36px" : `${layout.dockHeight}px`,
    "--dock-resizer-height": layout.dockCollapsed ? "0px" : "5px",
  } as CSSProperties;

  return (
    <section
      className={`program-runner ps-app${
        layout.dockCollapsed ? " is-dock-collapsed" : ""
      }${layout.leftCollapsed ? " is-explorer-collapsed" : ""}${
        layout.rightCollapsed ? " is-inspector-collapsed" : ""
      }${inspectorDrawerOpen ? " is-inspector-open" : ""}`}
      id="program-runner"
      style={rootStyle}
    >
      <div className="runner-shell">
        <ProgramToolbar
          commandValid={
            Boolean(program.trim()) &&
            !commandPreview.startsWith("参数错误")
          }
          isDirty={isDirty}
          isLeftCollapsed={layout.leftCollapsed}
          isRunning={isRunning}
          onChangeProjectName={setProjectName}
          onChangeTheme={changeTheme}
          onOpenProject={requestOpenProject}
          onRun={() => void runProgram()}
          onSave={() => void saveProjectFolder("auto")}
          onSaveAs={() => void saveProjectFolder("saveAs")}
          onToggleInspector={() => {
            setInspectorDrawerOpen((current) => !current);
            setLayout((current) => ({
              ...current,
              rightCollapsed: false,
            }));
          }}
          onToggleLeft={() =>
            setLayout((current) => ({
              ...current,
              leftCollapsed: !current.leftCollapsed,
            }))
          }
          projectName={projectName}
          projectPath={projectPath}
          resolvedTheme={resolvedTheme}
          themeMenuRef={themeMenuRef}
          themePreference={themePreference}
        />

        <div className="runner-layout">
          <ParameterSidebar
            activeFilePath={activeFile?.path ?? null}
            bindingsCount={bindings.length}
            collapsedTreeKeys={collapsedTreeKeys}
            fileInputRef={fileInputRef}
            files={files}
            isCollapsed={layout.leftCollapsed}
            locatedParameterKey={locatedBindingId}
            onAddFreeParameter={addFreeParameter}
            onFileInput={handleFileInput}
            onLoadExample={loadFa1Example}
            onLocateBinding={locateBinding}
            onOpenFiles={() => void openFiles()}
            onRemoveFile={removeFile}
            onSelectFile={(filePath) => {
              setActiveFilePath(filePath);
              setSelection({ start: 0, end: 0 });
            }}
            outputsByParameterKey={outputsByParameterKey}
            parameterDirection={parameterDirection}
            parameterFileGroups={parameterFileGroups}
            parameterQuery={parameterQuery}
            selectedParameterKey={
              selectedParameter ? parameterKey(selectedParameter) : null
            }
            setCollapsedTreeKeys={setCollapsedTreeKeys}
            setParameterDirection={setParameterDirection}
            setParameterQuery={setParameterQuery}
            setTab={setLeftSidebarTab}
            tab={leftSidebarTab}
            visibleBindingsCount={visibleBindings.length}
          />

          <div
            aria-label="调整文件面板宽度"
            aria-orientation="vertical"
            className="pane-resizer pane-resizer-left"
            onDoubleClick={() =>
              setLayout((current) => ({
                ...current,
                leftWidth: DEFAULT_LAYOUT.leftWidth,
                leftCollapsed: false,
              }))
            }
            onKeyDown={(event) => resizeWithKeyboard("left", event)}
            onPointerDown={(event) => beginResize("left", event)}
            role="separator"
            tabIndex={0}
          />

          <SourceWorkspace
            activeFile={activeFile}
            editingBinding={editingBinding ?? null}
            editorRef={editorRef}
            highlightRanges={editorHighlightRanges}
            locatedBinding={selectedBinding}
            onChange={(change) =>
              activeFile ? updateFile(activeFile.path, change) : undefined
            }
            onEditorContextMenu={handleEditorContextMenu}
            onLoadExample={loadFa1Example}
            onLocateShortcut={() => addBinding("input")}
            onMoveFile={moveFile}
            onOpenFiles={() => void openFiles()}
            onOpenProject={requestOpenProject}
            onSelectionChange={setSelection}
            onValueDoubleClick={handleEditorDoubleClick}
            resolvedTheme={resolvedTheme}
            selectedText={selectedText}
          />

          <div
            aria-label="调整检查器宽度"
            aria-orientation="vertical"
            className="pane-resizer pane-resizer-right"
            onDoubleClick={() =>
              setLayout((current) => ({
                ...current,
                rightWidth: DEFAULT_LAYOUT.rightWidth,
                rightCollapsed: false,
              }))
            }
            onKeyDown={(event) => resizeWithKeyboard("right", event)}
            onPointerDown={(event) => beginResize("right", event)}
            role="separator"
            tabIndex={0}
          />

          <InspectorPanel
            argumentText={argumentText}
            editingBinding={
              editingBinding && isFileBinding(editingBinding)
                ? editingBinding
                : null
            }
            inputReferenceResolution={inputReferenceResolution}
            isCollapsed={layout.rightCollapsed}
            launchMode={launchMode}
            locatorMode={locatorMode}
            locatorModeValues={locatorModeValues}
            onApplyLocator={applyLocatorEdit}
            onBeginEditLocator={beginEditLocator}
            onCancelLocator={cancelLocatorEdit}
            onClose={() => {
              setLayout((current) => ({
                ...current,
                rightCollapsed: true,
              }));
              setInspectorDrawerOpen(false);
            }}
            onLocateBinding={locateBinding}
            onRemoveBinding={removeBinding}
            program={program}
            selectedParameter={selectedParameter}
            selectedParameterFileLabel={selectedParameterFileLabel}
            selectedParameterOutput={selectedParameterOutput ?? null}
            selectedParameterValueError={selectedParameterValueError}
            setArgumentText={setArgumentText}
            setLaunchMode={setLaunchMode}
            setLocatorMode={setLocatorMode}
            setProgram={setProgram}
            setTab={setInspectorTab}
            setWorkingDirectory={setWorkingDirectory}
            tab={inspectorTab}
            updateBinding={updateBinding}
            updateLocatorValue={updateLocatorValue}
            visibleAutoTokenRange={visibleAutoTokenRange}
            workingDirectory={workingDirectory}
          />
        </div>

        <RunDock
          collapsed={layout.dockCollapsed}
          commandPreview={commandPreview}
          isRunning={isRunning}
          onCopyCommand={() => void copyCommand()}
          onResetSize={() =>
            setLayout((current) => ({
              ...current,
              dockHeight: DEFAULT_LAYOUT.dockHeight,
              dockCollapsed: false,
            }))
          }
          onResizeKey={(event) => resizeWithKeyboard("dock", event)}
          onResizeStart={(event) => beginResize("dock", event)}
          onToggleCollapsed={() =>
            setLayout((current) => ({
              ...current,
              dockCollapsed: !current.dockCollapsed,
            }))
          }
          runtimeResult={runtimeResult}
        />

        <footer className="app-statusbar" aria-label="应用状态">
          <span className="status-mode">
            <i />
            本机模式
          </span>
          <span className="status-path" title={projectPath ?? ""}>
            {projectPath ?? "未保存工程"}
          </span>
          <span className="status-spacer" />
          {isDirty && <span className="status-dirty">未保存</span>}
          <span>
            {selectedText ? `${selectedText.length} 字符` : "未选择文本"}
          </span>
          <span>{isRunning ? "程序运行中" : "就绪"}</span>
        </footer>

        {notice && (
          <div
            aria-live={notice.tone === "error" ? "assertive" : "polite"}
            className={`runner-notice is-${notice.tone}`}
            role={notice.tone === "error" ? "alert" : "status"}
          >
            <span>{notice.tone === "error" ? "!" : "✓"}</span>
            <p>{notice.text}</p>
            <button
              aria-label="关闭提示"
              onClick={() => setNotice(null)}
              type="button"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {editorContextMenu && activeFile && (
        <div
          aria-label="编辑器参数菜单"
          className="editor-context-menu"
          ref={editorContextMenuRef}
          role="menu"
          style={{
            left: editorContextMenu.x,
            top: editorContextMenu.y,
          }}
        >
          <div className="editor-context-menu-selection">
            <span>当前选区</span>
            <strong title={editorContextText}>
              {editorContextText || "未选择文本"}
            </strong>
          </div>
          <button
            disabled={
              editorContextMenu.range.end <=
                editorContextMenu.range.start
            }
            onClick={() => {
              const range = editorContextMenu.range;
              setEditorContextMenu(null);
              addBinding("input", range);
            }}
            role="menuitem"
            type="button"
          >
            <span className="editor-context-menu-mark">IN</span>
            添加为输入参数
          </button>
          <button
            disabled={
              editorContextMenu.range.end <=
                editorContextMenu.range.start
            }
            onClick={() => {
              const range = editorContextMenu.range;
              setEditorContextMenu(null);
              addBinding("output", range);
            }}
            role="menuitem"
            type="button"
          >
            <span className="editor-context-menu-mark is-output">OUT</span>
            添加为输出参数
          </button>
        </div>
      )}

      {confirmOpenProject && (
        <div className="dialog-backdrop">
          <div
            aria-describedby="unsaved-project-description"
            aria-labelledby="unsaved-project-title"
            aria-modal="true"
            className="confirm-dialog"
            role="dialog"
          >
            <div className="confirm-dialog-icon">!</div>
            <div>
              <h2 id="unsaved-project-title">打开其他工程？</h2>
              <p id="unsaved-project-description">
                当前工程包含未保存的更改。继续打开其他工程会放弃这些更改。
              </p>
            </div>
            <div className="confirm-dialog-actions">
              <button
                autoFocus
                onClick={() => setConfirmOpenProject(false)}
                type="button"
              >
                返回编辑
              </button>
              <button
                className="is-danger"
                onClick={() => {
                  setConfirmOpenProject(false);
                  void openProjectFolder();
                }}
                type="button"
              >
                放弃并打开
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
