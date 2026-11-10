import type { RefObject } from "react";
import type { ResolvedTheme, ThemePreference } from "../../lib/theme";
import {
  AddIcon,
  FolderIcon,
  MonitorIcon,
  MoonIcon,
  PanelIcon,
  PlayIcon,
  SaveIcon,
  SunIcon,
} from "./ProgramIcons";

interface ProgramToolbarProps {
  commandValid: boolean;
  isDirty: boolean;
  isLeftCollapsed: boolean;
  isRunning: boolean;
  projectName: string;
  projectPath: string | null;
  resolvedTheme: ResolvedTheme;
  themeMenuRef: RefObject<HTMLDetailsElement | null>;
  themePreference: ThemePreference;
  onChangeProjectName: (value: string) => void;
  onChangeTheme: (preference: ThemePreference) => void;
  onNewProject: () => void;
  onOpenProject: () => void;
  onRun: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onToggleInspector: () => void;
  onToggleLeft: () => void;
}

export function ProgramToolbar({
  commandValid,
  isDirty,
  isLeftCollapsed,
  isRunning,
  projectName,
  projectPath,
  resolvedTheme,
  themeMenuRef,
  themePreference,
  onChangeProjectName,
  onChangeTheme,
  onNewProject,
  onOpenProject,
  onRun,
  onSave,
  onSaveAs,
  onToggleInspector,
  onToggleLeft,
}: ProgramToolbarProps) {
  return (
    <header className="runner-topbar" aria-label="应用工具栏">
      <div className="app-brand-block">
        <span className="app-brand-mark" aria-hidden="true">
          PS
        </span>
        <div className="app-brand-copy">
          <strong>Program Studio</strong>
          <span>本机程序工作台</span>
        </div>
      </div>
      <div className="runner-project-title">
        <div className="project-title-line">
          <input
            aria-label="工程名称"
            onChange={(event) => onChangeProjectName(event.target.value)}
            value={projectName}
          />
          {isDirty && (
            <span
              aria-label="有未保存的更改"
              className="dirty-indicator"
              title="有未保存的更改"
            />
          )}
        </div>
        <span className="runner-project-path" title={projectPath ?? ""}>
          {projectPath ?? "尚未保存到工程目录"}
        </span>
      </div>
      <div className="runner-project-actions">
        <button
          aria-label={isLeftCollapsed ? "展开文件面板" : "收起文件面板"}
          className="toolbar-icon-button"
          onClick={onToggleLeft}
          title={isLeftCollapsed ? "展开文件面板" : "收起文件面板"}
          type="button"
        >
          <PanelIcon />
        </button>
        <button
          onClick={onNewProject}
          title="新建空白工程 (Ctrl+N)"
          type="button"
        >
          <AddIcon />
          <span>新建工程</span>
        </button>
        <button
          onClick={onOpenProject}
          title="打开工程目录"
          type="button"
        >
          <FolderIcon />
          <span>打开工程</span>
        </button>
        <button
          aria-label="保存工程"
          onClick={onSave}
          title="保存工程目录并更新已修改的原文件"
          type="button"
        >
          <SaveIcon />
          <span>保存</span>
        </button>
        <button
          onClick={onSaveAs}
          title="另存到新的工程目录"
          type="button"
        >
          另存为
        </button>
        <details className="theme-menu" ref={themeMenuRef}>
          <summary aria-label="切换主题" title="切换主题">
            {resolvedTheme === "dark" ? <MoonIcon /> : <SunIcon />}
            <span>主题</span>
          </summary>
          <div className="theme-menu-popover" role="menu">
            <button
              aria-checked={themePreference === "system"}
              onClick={() => onChangeTheme("system")}
              role="menuitemradio"
              type="button"
            >
              <MonitorIcon />
              跟随系统
            </button>
            <button
              aria-checked={themePreference === "light"}
              onClick={() => onChangeTheme("light")}
              role="menuitemradio"
              type="button"
            >
              <SunIcon />
              亮色
            </button>
            <button
              aria-checked={themePreference === "dark"}
              onClick={() => onChangeTheme("dark")}
              role="menuitemradio"
              type="button"
            >
              <MoonIcon />
              暗色
            </button>
          </div>
        </details>
        <button
          className="toolbar-icon-button inspector-toggle"
          onClick={onToggleInspector}
          title="切换检查器"
          type="button"
        >
          <PanelIcon />
          <span>检查器</span>
        </button>
        <button
          className="toolbar-run-button"
          disabled={isRunning || !commandValid}
          onClick={onRun}
          title="运行程序"
          type="button"
        >
          <PlayIcon />
          <span>{isRunning ? "运行中…" : "运行程序"}</span>
        </button>
      </div>
    </header>
  );
}
