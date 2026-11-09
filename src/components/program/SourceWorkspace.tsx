import type { RefObject } from "react";
import type { LaunchBinding, LaunchFile } from "../../lib/launcher";
import type { SourceEditorChange } from "../../lib/relocation";
import type { ResolvedTheme } from "../../lib/theme";
import type { SourceRange } from "../../lib/variables";
import SourceEditor, {
  type EditorContextMenuRequest,
  type SourceEditorHandle,
} from "../SourceEditor";
import { AddIcon, FileIcon, FolderIcon } from "./ProgramIcons";

interface SourceWorkspaceProps {
  activeFile: LaunchFile | null;
  editingBinding: LaunchBinding | null;
  editorRef: RefObject<SourceEditorHandle | null>;
  highlightRanges: SourceRange[];
  locatedBinding: LaunchBinding | null;
  resolvedTheme: ResolvedTheme;
  selectedText: string;
  onChange: (change: SourceEditorChange) => void;
  onEditorContextMenu: (request: EditorContextMenuRequest) => void;
  onLoadExample: () => void;
  onLocateShortcut: () => void;
  onMoveFile: (previousPath: string, nextPath: string) => void;
  onOpenFiles: () => void;
  onOpenProject: () => void;
  onSelectionChange: (range: SourceRange) => void;
  onValueDoubleClick: (position: number) => void;
}

export function SourceWorkspace({
  activeFile,
  editingBinding,
  editorRef,
  highlightRanges,
  locatedBinding,
  resolvedTheme,
  selectedText,
  onChange,
  onEditorContextMenu,
  onLoadExample,
  onLocateShortcut,
  onMoveFile,
  onOpenFiles,
  onOpenProject,
  onSelectionChange,
  onValueDoubleClick,
}: SourceWorkspaceProps) {
  return (
    <div className="runner-editor-panel">
      <div className="runner-editor-heading">
        <div>
          <span>当前文件</span>
          <strong>{activeFile?.path ?? "请选择文件"}</strong>
        </div>
        <span className="runner-selection-count">
          {selectedText.length > 0
            ? `${selectedText.length} 字符`
            : "等待选择"}
        </span>
      </div>
      {activeFile && (
        <label className="runner-file-path-field">
          <span>文件路径</span>
          <input
            defaultValue={activeFile.path}
            key={activeFile.path}
            onBlur={(event) =>
              onMoveFile(activeFile.path, event.currentTarget.value)
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
          />
        </label>
      )}
      <div className="runner-editor-shell">
        {activeFile ? (
          <SourceEditor
            ariaLabel={`程序文件 ${activeFile.name}`}
            flavor={activeFile.flavor}
            highlightRanges={highlightRanges}
            onChange={onChange}
            onEditorContextMenu={onEditorContextMenu}
            onLocateShortcut={onLocateShortcut}
            onSelectionChange={onSelectionChange}
            onValueDoubleClick={onValueDoubleClick}
            ref={editorRef}
            theme={resolvedTheme}
            value={activeFile.content}
          />
        ) : (
          <div className="runner-editor-empty">
            <span className="empty-mark">
              <FileIcon />
            </span>
            <strong>打开一个工作区</strong>
            <p>导入文本文件，在原文中选择内容并绑定输入或输出参数。</p>
            <div className="empty-actions">
              <button onClick={onOpenFiles} type="button">
                <AddIcon />
                导入文本文件
              </button>
              <button
                onClick={onOpenProject}
                type="button"
              >
                <FolderIcon />
                打开工程
              </button>
              <button onClick={onLoadExample} type="button">
                加载标准示例
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="runner-selection-bar">
        <div>
          <span>当前选区</span>
          <strong title={selectedText}>
            {selectedText || "在编辑器中拖选要定位的内容"}
          </strong>
        </div>
        {(editingBinding || locatedBinding) && (
          <small
            title={
              editingBinding
                ? `正在重新定位：${editingBinding.name}`
                : `已定位参数：${locatedBinding?.name ?? ""}`
            }
          >
            {editingBinding
              ? `重新定位 · ${editingBinding.name}`
              : `已定位 · ${locatedBinding?.name ?? ""}`}
          </small>
        )}
        <span className="runner-binding-context-hint">
          选中内容后右键添加参数
        </span>
      </div>
    </div>
  );
}
