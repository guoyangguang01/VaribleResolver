import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import SourceEditor, {
  type EditorContextMenuRequest,
  type SourceEditorHandle,
} from "./SourceEditor";
import {
  LauncherError,
  LAUNCH_PARAMETER_TYPES,
  buildLaunchCommand,
  createAutoPositionLocator,
  createBindingFromLocator,
  createBindingFromSelection,
  createLaunchFile,
  createLocatorForMode,
  extractOutputBindings,
  interpolateArguments,
  parseCommandArguments,
  resolveLaunchBinding,
  validateParameterValue,
  writeInputBindings,
  type AutoTokenRange,
  type LaunchBinding,
  type LaunchBindingDirection,
  type LaunchFile,
  type LaunchLocator,
  type LaunchLocatorMode,
  type LaunchParameterType,
  type LocatorModeValues,
  type OutputExtraction,
} from "../lib/launcher";
import {
  lineNumberAt,
  normalizeSourceText,
  sourceFlavorFromFilename,
  type SourceRange,
} from "../lib/variables";
import { buildFa1Example } from "../lib/fa1Example";
import {
  parseProjectFolder,
  serializeProjectFolder,
  type ProjectFolderPayload,
  type ProjectSnapshot,
} from "../lib/projectFolder";
import {
  readThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from "../lib/theme";
import {
  executeProjectWithOverrides,
  type ProjectInputOverride,
} from "../lib/projectExecution";
import { createDesktopExecutionAdapter } from "../lib/desktopExecutionAdapter";

const MAX_FILE_SIZE = 8 * 1024 * 1024;
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

type NoticeTone = "neutral" | "success" | "error";

interface WorkbenchLayout {
  leftWidth: number;
  rightWidth: number;
  dockHeight: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  dockCollapsed: boolean;
}

type LeftSidebarTab = "files" | "parameters";
type InspectorTab = "parameter" | "launch" | "locator";

const LAYOUT_STORAGE_KEY = "program-studio-workbench-layout-v2";
const DEFAULT_LAYOUT: WorkbenchLayout = {
  leftWidth: 232,
  rightWidth: 320,
  dockHeight: 180,
  leftCollapsed: false,
  rightCollapsed: false,
  dockCollapsed: true,
};

interface RunnerNotice {
  tone: NoticeTone;
  text: string;
}

interface PendingRange {
  filePath: string;
  range: SourceRange;
  select?: boolean;
}

interface EditorContextMenuState {
  x: number;
  y: number;
  range: SourceRange;
}

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function projectRevision(snapshot: ProjectSnapshot): string {
  return JSON.stringify({
    name: snapshot.name,
    program: snapshot.program,
    arguments: snapshot.arguments,
    workingDirectory: snapshot.workingDirectory,
    files: snapshot.files.map((file) => ({
      path: file.path,
      content: file.content,
    })),
    bindings: snapshot.bindings,
  });
}

function readWorkbenchLayout(): WorkbenchLayout {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "null",
    ) as Partial<WorkbenchLayout> | null;
    if (!stored) return DEFAULT_LAYOUT;
    return {
      leftWidth: clampNumber(stored.leftWidth, 200, 360, 232),
      rightWidth: clampNumber(stored.rightWidth, 280, 460, 320),
      dockHeight: clampNumber(stored.dockHeight, 180, 480, 260),
      leftCollapsed: Boolean(stored.leftCollapsed),
      rightCollapsed: Boolean(stored.rightCollapsed),
      dockCollapsed: Boolean(stored.dockCollapsed),
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function clampNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function SmallIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height="15"
      viewBox="0 0 24 24"
      width="15"
    >
      {children}
    </svg>
  );
}

function AddIcon() {
  return (
    <SmallIcon>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeLinecap="round" />
    </SmallIcon>
  );
}

function CopyIcon() {
  return (
    <SmallIcon>
      <rect height="12" rx="1.5" stroke="currentColor" width="11" x="8" y="8" />
      <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" stroke="currentColor" />
    </SmallIcon>
  );
}

function PlayIcon() {
  return (
    <SmallIcon>
      <path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" />
    </SmallIcon>
  );
}

function FileIcon() {
  return (
    <SmallIcon>
      <path d="M6 3.5h7l5 5V20.5H6z" stroke="currentColor" strokeLinejoin="round" />
      <path d="M13 3.5v5h5" stroke="currentColor" strokeLinejoin="round" />
    </SmallIcon>
  );
}

function FolderIcon() {
  return (
    <SmallIcon>
      <path d="M3.5 6.5h6l2 2H20.5v10h-17z" stroke="currentColor" strokeLinejoin="round" />
    </SmallIcon>
  );
}

function SaveIcon() {
  return (
    <SmallIcon>
      <path d="M4 4h13l3 3v13H4z" stroke="currentColor" strokeLinejoin="round" />
      <path d="M8 4v6h8V4M8 20v-6h8v6" stroke="currentColor" strokeLinejoin="round" />
    </SmallIcon>
  );
}

function PanelIcon() {
  return (
    <SmallIcon>
      <rect height="15" rx="2" stroke="currentColor" width="17" x="3.5" y="4.5" />
      <path d="M15 4.5v15" stroke="currentColor" />
    </SmallIcon>
  );
}

function SunIcon() {
  return (
    <SmallIcon>
      <circle cx="12" cy="12" r="3.5" stroke="currentColor" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" stroke="currentColor" strokeLinecap="round" />
    </SmallIcon>
  );
}

function MoonIcon() {
  return (
    <SmallIcon>
      <path d="M19 15.5A7.5 7.5 0 0 1 8.5 5 7.5 7.5 0 1 0 19 15.5Z" stroke="currentColor" strokeLinejoin="round" />
    </SmallIcon>
  );
}

function MonitorIcon() {
  return (
    <SmallIcon>
      <rect height="12" rx="1.5" stroke="currentColor" width="17" x="3.5" y="4.5" />
      <path d="M9 20h6M12 16.5V20" stroke="currentColor" strokeLinecap="round" />
    </SmallIcon>
  );
}

function bindingName(
  requestedName: string,
  direction: LaunchBindingDirection,
  bindings: LaunchBinding[],
): string {
  const base = requestedName.trim() || `${direction === "input" ? "输入" : "输出"}参数`;
  const names = new Set(bindings.map((binding) => binding.name));
  if (!names.has(base)) return base;
  let suffix = 2;
  while (names.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

function locatorLabel(binding: LaunchBinding): string {
  switch (binding.locator.kind) {
    case "autoPosition":
      return `自动 · R${binding.locator.startRowIndex}:C${binding.locator.startColumnIndex}`;
    case "rowColumn":
      return `固定长度 · R${binding.locator.startRowIndex}:C${binding.locator.startColumnIndex}`;
    case "startColumn":
      return `起始列 · R${binding.locator.rowIndex}:C${binding.locator.startColumnIndex}`;
    case "wholeLine":
      return `整行 · R${binding.locator.rowIndex}`;
    case "multiLine":
      return `多行 · R${binding.locator.startRowIndex}-R${binding.locator.endRowIndex}`;
    case "delimited":
      return `分段 · 第 ${binding.locator.fieldIndex} 段`;
    case "marker":
      return "不定行 · 标记范围";
    case "jsonPath":
      return `JSON · ${binding.locator.path}`;
    case "xmlPath":
      return `XML · ${binding.locator.path}`;
    case "pattern":
      return `模式 · /${binding.locator.pattern}/`;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败。";
}

function locatorEditorState(locator: LaunchLocator): {
  mode: LaunchLocatorMode;
  values: LocatorModeValues;
} {
  switch (locator.kind) {
    case "autoPosition":
      return {
        mode: "auto",
        values: {
          startRowIndex: locator.startRowIndex,
          startColumnIndex: locator.startColumnIndex,
          endRowIndex: locator.endRowIndex,
          endColumnIndex: locator.endColumnIndex,
        },
      };
    case "rowColumn":
      return {
        mode: "fixedLength",
        values: {
          startRowIndex: locator.startRowIndex,
          startColumnIndex: locator.startColumnIndex,
          endRowIndex: locator.endRowIndex,
          endColumnIndex: locator.endColumnIndex,
        },
      };
    case "startColumn":
      return {
        mode: "startColumn",
        values: {
          startRowIndex: locator.rowIndex,
          startColumnIndex: locator.startColumnIndex,
        },
      };
    case "wholeLine":
      return {
        mode: "wholeLine",
        values: { startRowIndex: locator.rowIndex },
      };
    case "multiLine":
      return {
        mode: "multiLine",
        values: {
          startRowIndex: locator.startRowIndex,
          endRowIndex: locator.endRowIndex,
        },
      };
    case "delimited":
      return {
        mode: "delimited",
        values: {
          startRowIndex: locator.rowIndex,
          separator: locator.separator,
          fieldIndex: locator.fieldIndex,
        },
      };
    case "marker":
      return {
        mode: "indefiniteLine",
        values: {
          startMarker: locator.startMarker,
          endMarker: locator.endMarker,
          occurrence: locator.occurrence,
        },
      };
    case "jsonPath":
      return {
        mode: "jsonPath",
        values: { jsonPath: locator.path },
      };
    case "xmlPath":
      return {
        mode: "xmlPath",
        values: { xmlPath: locator.path },
      };
    case "pattern":
      return {
        mode: "pattern",
        values: {
          pattern: locator.pattern,
          flags: locator.flags,
          captureGroup: locator.captureGroup,
          occurrence: locator.occurrence,
        },
      };
  }
}

function locatorDetails(
  locator: LaunchLocator,
): Array<{ label: string; value: string }> {
  switch (locator.kind) {
    case "autoPosition": {
      const details = [
        { label: "起始行", value: String(locator.startRowIndex) },
        { label: "起始列", value: String(locator.startColumnIndex) },
        { label: "结束行", value: String(locator.endRowIndex) },
        { label: "结束列", value: String(locator.endColumnIndex) },
      ];
      if (locator.tokenRange) {
        details.push(...tokenRangeDetails(locator.tokenRange));
      }
      return details;
    }
    case "rowColumn":
      return [
        { label: "起始行", value: String(locator.startRowIndex) },
        { label: "起始列", value: String(locator.startColumnIndex) },
        { label: "结束行", value: String(locator.endRowIndex) },
        { label: "结束列", value: String(locator.endColumnIndex) },
      ];
    case "startColumn":
      return [
        { label: "行", value: String(locator.rowIndex) },
        { label: "起始列", value: String(locator.startColumnIndex) },
      ];
    case "wholeLine":
      return [{ label: "行", value: String(locator.rowIndex) }];
    case "multiLine":
      return [
        { label: "起始行", value: String(locator.startRowIndex) },
        { label: "结束行", value: String(locator.endRowIndex) },
      ];
    case "delimited":
      return [
        { label: "行", value: String(locator.rowIndex) },
        { label: "分隔符", value: locator.separator },
        { label: "分段序号", value: String(locator.fieldIndex) },
      ];
    case "marker":
      return [
        { label: "起始标记", value: locator.startMarker },
        { label: "结束标记", value: locator.endMarker },
        { label: "匹配序号", value: String(locator.occurrence) },
      ];
    case "jsonPath":
      return [{ label: "JSON 路径", value: locator.path }];
    case "xmlPath":
      return [{ label: "XML 路径", value: locator.path }];
    case "pattern":
      return [
        { label: "正则表达式", value: locator.pattern },
        { label: "标志", value: locator.flags || "无" },
        { label: "捕获组", value: String(locator.captureGroup) },
        { label: "匹配序号", value: String(locator.occurrence) },
      ];
  }
}

function tokenRangeDetails(
  tokenRange: AutoTokenRange,
): Array<{ label: string; value: string }> {
  return [
    { label: "Token 定位", value: "特殊字符相对边界" },
    { label: "Token 数量", value: String(tokenRange.tokenCount) },
    {
      label: "起始 Token",
      value: `第 ${tokenRange.startTokenIndex + 1} 个 +${tokenRange.startOffsetFromTokenStart}`,
    },
    {
      label: "结束 Token",
      value: `第 ${tokenRange.endTokenIndex + 1} 个 -${tokenRange.endOffsetFromTokenEnd}`,
    },
  ];
}

function selectionScore(
  selection: SourceRange,
  resolved: SourceRange,
): number {
  if (selection.start === selection.end) {
    return selection.start >= resolved.start &&
      selection.start <= resolved.end
      ? 1
      : 0;
  }
  const overlapStart = Math.max(selection.start, resolved.start);
  const overlapEnd = Math.min(selection.end, resolved.end);
  if (overlapEnd <= overlapStart) return 0;
  const selectionLength = selection.end - selection.start;
  const resolvedLength = resolved.end - resolved.start;
  const overlap = overlapEnd - overlapStart;
  let score = overlap / Math.max(1, Math.max(selectionLength, resolvedLength));
  if (
    selection.start === resolved.start &&
    selection.end === resolved.end
  ) {
    score += 2;
  }
  return score;
}

export default function ProgramLauncher() {
  const [files, setFiles] = useState<LaunchFile[]>([]);
  const [projectName, setProjectName] = useState("未命名工程");
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [projectRelativeFilePaths, setProjectRelativeFilePaths] =
    useState<Record<string, string>>({});
  const [projectCreatedAt, setProjectCreatedAt] = useState<string | null>(
    null,
  );
  const [activeFilePath, setActiveFilePath] = useState<string | null>(
    () => files[0]?.path ?? null,
  );
  const [selection, setSelection] = useState<SourceRange>({
    start: 0,
    end: 0,
  });
  const [bindings, setBindings] = useState<LaunchBinding[]>([]);
  const [program, setProgram] = useState("");
  const [argumentText, setArgumentText] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("");
  const [locatorMode, setLocatorMode] =
    useState<LaunchLocatorMode>("auto");
  const [editingBindingId, setEditingBindingId] = useState<string | null>(
    null,
  );
  const [locatorModeValues, setLocatorModeValues] =
    useState<LocatorModeValues>({
      startRowIndex: 1,
      startColumnIndex: 0,
      endRowIndex: 1,
      endColumnIndex: 0,
      fieldIndex: 0,
      captureGroup: 0,
      occurrence: 0,
    });
  const [parameterQuery, setParameterQuery] = useState("");
  const [parameterDirection, setParameterDirection] = useState<
    "all" | LaunchBindingDirection
  >("all");
  const [collapsedTreeKeys, setCollapsedTreeKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [locatedBindingId, setLocatedBindingId] = useState<string | null>(
    null,
  );
  const [selectedParameterId, setSelectedParameterId] = useState<
    string | null
  >(null);
  const [notice, setNotice] = useState<RunnerNotice | null>(null);
  const [outputs, setOutputs] = useState<OutputExtraction[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [runtimeResult, setRuntimeResult] =
    useState<DesktopRunResult | null>(null);
  const [pendingRange, setPendingRange] = useState<PendingRange | null>(
    null,
  );
  const [editorContextMenu, setEditorContextMenu] =
    useState<EditorContextMenuState | null>(null);
  const [layout, setLayout] =
    useState<WorkbenchLayout>(readWorkbenchLayout);
  const [leftSidebarTab, setLeftSidebarTab] =
    useState<LeftSidebarTab>("files");
  const [inspectorTab, setInspectorTab] =
    useState<InspectorTab>("launch");
  const [inspectorDrawerOpen, setInspectorDrawerOpen] = useState(false);
  const [confirmOpenProject, setConfirmOpenProject] = useState(false);
  const [themePreference, setThemePreference] =
    useState<ThemePreference>(readThemePreference);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [savedRevision, setSavedRevision] = useState(() =>
    projectRevision({
      name: "未命名工程",
      program: "",
      arguments: "",
      workingDirectory: "",
      files: [],
      bindings: [],
    }),
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<SourceEditorHandle>(null);
  const editorContextMenuRef = useRef<HTMLDivElement>(null);
  const themeMenuRef = useRef<HTMLDetailsElement>(null);
  const desktopApi = window.programStudio;
  const resolvedTheme = resolveTheme(
    themePreference,
    systemPrefersDark,
  );
  const currentRevision = useMemo(
    () =>
      projectRevision({
        name: projectName,
        program,
        arguments: argumentText,
        workingDirectory,
        files,
        bindings,
      }),
    [
      argumentText,
      bindings,
      files,
      program,
      projectName,
      workingDirectory,
    ],
  );
  const isDirty = currentRevision !== savedRevision;

  useEffect(() => {
    window.localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify(layout),
    );
  }, [layout]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };
    setSystemPrefersDark(media.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        resolvedTheme === "dark" ? "#14171c" : "#f3f5f7",
      );
    window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
    desktopApi?.setTheme?.(themePreference);
  }, [desktopApi, resolvedTheme, themePreference]);

  useEffect(() => {
    desktopApi?.setDirty?.(isDirty);
    if (desktopApi) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [desktopApi, isDirty]);

  useEffect(() => {
    if (!notice || notice.tone === "error") return;
    const timeout = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!editorContextMenu) return;
    const focusFrame = requestAnimationFrame(() => {
      editorContextMenuRef.current
        ?.querySelector<HTMLButtonElement>("button")
        ?.focus();
    });
    const closeMenu = () => setEditorContextMenu(null);
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        editorContextMenuRef.current?.contains(event.target)
      ) {
        return;
      }
      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeMenu();
      editorRef.current?.focus();
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", closeMenu);
    window.addEventListener("resize", closeMenu);
    document.addEventListener("scroll", closeMenu, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", closeMenu);
      window.removeEventListener("resize", closeMenu);
      document.removeEventListener("scroll", closeMenu, true);
    };
  }, [editorContextMenu]);

  const activeFile =
    files.find((file) => file.path === activeFilePath) ??
    files[0] ??
    null;
  const activeBindings = useMemo(
    () =>
      activeFile
        ? bindings.filter(
            (binding) => binding.filePath === activeFile.path,
          )
        : [],
    [activeFile, bindings],
  );
  const selectedText =
    activeFile && selection.end > selection.start
      ? activeFile.content.slice(selection.start, selection.end)
      : "";
  const editorContextText =
    activeFile && editorContextMenu
      ? activeFile.content.slice(
          editorContextMenu.range.start,
          editorContextMenu.range.end,
        )
      : "";
  const inputs = bindings.filter(
    (binding) => binding.direction === "input",
  );
  const outputBindings = bindings.filter(
    (binding) => binding.direction === "output",
  );
  const filesByPath = useMemo(
    () => new Map(files.map((file) => [file.path, file])),
    [files],
  );
  const outputsById = useMemo(
    () => new Map(outputs.map((output) => [output.bindingId, output])),
    [outputs],
  );
  const editingBinding = bindings.find(
    (binding) => binding.id === editingBindingId,
  );
  const autoTokenRangePreview = useMemo(() => {
    if (
      locatorMode !== "auto" ||
      !activeFile ||
      selection.end <= selection.start
    ) {
      return null;
    }
    try {
      return (
        createAutoPositionLocator(activeFile, selection).tokenRange ?? null
      );
    } catch {
      return null;
    }
  }, [activeFile, locatorMode, selection.end, selection.start]);
  const visibleAutoTokenRange =
    locatorMode === "auto"
      ? autoTokenRangePreview ??
        (editingBinding?.locator.kind === "autoPosition"
          ? editingBinding.locator.tokenRange ?? null
          : null)
      : null;
  const visibleBindings = useMemo(() => {
    const query = parameterQuery.trim().toLowerCase();
    return bindings.filter((binding) => {
      if (
        parameterDirection !== "all" &&
        binding.direction !== parameterDirection
      ) {
        return false;
      }
      if (!query) return true;
      return `${binding.name} ${binding.filePath} ${binding.parameterType} ${
        binding.defaultValue
      } ${binding.unit} ${binding.description} ${locatorLabel(binding)}`
        .toLowerCase()
        .includes(query);
    });
  }, [bindings, parameterDirection, parameterQuery]);
  const parameterFileGroups = useMemo(() => {
    const hasActiveFilter =
      Boolean(parameterQuery.trim()) || parameterDirection !== "all";
    const knownPaths = new Set(files.map((file) => file.path));
    const groups = files.map((file) => {
      const fileBindings = visibleBindings.filter(
        (binding) => binding.filePath === file.path,
      );
      return {
        path: file.path,
        name: file.name,
        inputs: fileBindings.filter(
          (binding) => binding.direction === "input",
        ),
        outputs: fileBindings.filter(
          (binding) => binding.direction === "output",
        ),
      };
    });
    const missingBindings = visibleBindings.filter(
      (binding) => !knownPaths.has(binding.filePath),
    );
    if (missingBindings.length > 0) {
      groups.push({
        path: "__missing__",
        name: "文件缺失",
        inputs: missingBindings.filter(
          (binding) => binding.direction === "input",
        ),
        outputs: missingBindings.filter(
          (binding) => binding.direction === "output",
        ),
      });
    }
    return hasActiveFilter
      ? groups.filter(
          (group) => group.inputs.length > 0 || group.outputs.length > 0,
        )
      : groups;
  }, [files, parameterDirection, parameterQuery, visibleBindings]);
  const selectedParameter =
    visibleBindings.find(
      (binding) => binding.id === selectedParameterId,
    ) ??
    visibleBindings[0] ??
    null;
  const selectedParameterFile = selectedParameter
    ? filesByPath.get(selectedParameter.filePath)
    : null;
  const selectedParameterFileLabel = selectedParameter
    ? (projectRelativeFilePaths[selectedParameter.filePath] ??
      selectedParameterFile?.name ??
      "未封装文件")
    : "";
  const selectedParameterOutput = selectedParameter
    ? outputsById.get(selectedParameter.id)
    : null;
  const selectedParameterValueError =
    selectedParameter?.direction === "input"
      ? validateParameterValue(
          selectedParameter.parameterType,
          selectedParameter.value,
        )
      : null;
  const commandPreview = useMemo(() => {
    try {
      return buildLaunchCommand(program, argumentText, bindings);
    } catch (error) {
      return `参数错误：${errorMessage(error)}`;
    }
  }, [argumentText, bindings, program]);
  const selectedBinding = useMemo(() => {
    if (
      !activeFile ||
      selection.end <= selection.start ||
      activeBindings.length === 0
    ) {
      return null;
    }
    return (
      activeBindings
        .flatMap((binding) => {
          try {
            const resolved = resolveLaunchBinding(
              activeFile.content,
              binding.locator,
            );
            let score = selectionScore(selection, resolved);
            return score > 0 ? [{ binding, score }] : [];
          } catch {
            return [];
          }
        })
        .sort((first, second) => second.score - first.score)[0]?.binding ??
      null
    );
  }, [activeBindings, activeFile, selection]);
  const scrollParameterRow = useCallback((bindingId: string) => {
    setLeftSidebarTab("parameters");
    setLayout((current) =>
      current.leftCollapsed
        ? { ...current, leftCollapsed: false }
        : current,
    );
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const row = document.querySelector<HTMLElement>(
          `[data-binding-id="${CSS.escape(bindingId)}"]`,
        );
        const body = row?.closest<HTMLElement>(
          ".runner-parameter-tree-body",
        );
        if (!row || !body) return;
        const rowRect = row.getBoundingClientRect();
        const bodyRect = body.getBoundingClientRect();
        if (
          rowRect.top < bodyRect.top ||
          rowRect.bottom > bodyRect.bottom
        ) {
          body.scrollTop +=
            rowRect.top -
            bodyRect.top -
            (body.clientHeight - rowRect.height) / 2;
        }
      });
    });
  }, []);
  const allBindingHighlightRanges = useMemo<SourceRange[]>(() => {
    if (!activeFile) return [];
    const ranges = activeBindings
      .flatMap((binding) => {
        try {
          const resolved = resolveLaunchBinding(
            activeFile.content,
            binding.locator,
          );
          return [{ start: resolved.start, end: resolved.end }];
        } catch {
          return [];
        }
      })
      .sort(
        (first, second) =>
          first.start - second.start || first.end - second.end,
      );
    return ranges.reduce<SourceRange[]>((merged, range) => {
      const previous = merged.at(-1);
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        merged.push({ ...range });
      }
      return merged;
    }, []);
  }, [activeBindings, activeFile]);
  const editorHighlightRanges = allBindingHighlightRanges;

  useEffect(() => {
    if (!activeFilePath && files[0]) {
      setActiveFilePath(files[0].path);
    }
    if (
      activeFilePath &&
      !files.some((file) => file.path === activeFilePath)
    ) {
      setActiveFilePath(files[0]?.path ?? null);
    }
  }, [activeFilePath, files]);

  useEffect(() => {
    if (
      !pendingRange ||
      pendingRange.filePath !== activeFilePath ||
      !activeFile
    ) {
      return;
    }
    const animation = requestAnimationFrame(() => {
      if (pendingRange.select === false) {
        editorRef.current?.scrollToRange(
          pendingRange.range.start,
          pendingRange.range.end,
        );
      } else {
        editorRef.current?.selectRange(
          pendingRange.range.start,
          pendingRange.range.end,
        );
        setSelection(pendingRange.range);
      }
      setPendingRange(null);
    });
    return () => cancelAnimationFrame(animation);
  }, [activeFile, activeFilePath, pendingRange]);

  useEffect(() => {
    if (!activeFile || selection.end <= selection.start) return;
    if (editingBindingId) {
      setLocatorMode("auto");
    }
    const startRow =
      activeFile.content.slice(0, selection.start).split("\n").length;
    const endRow =
      activeFile.content.slice(0, selection.end).split("\n").length;
    const startLineStart =
      activeFile.content.lastIndexOf("\n", selection.start - 1) + 1;
    const endLineStart =
      activeFile.content.lastIndexOf("\n", selection.end - 1) + 1;
    setLocatorModeValues((current) => ({
      ...current,
      startRowIndex: startRow,
      startColumnIndex: selection.start - startLineStart,
      endRowIndex: endRow,
      endColumnIndex: selection.end - endLineStart,
    }));
  }, [activeFile, editingBindingId, selection.end, selection.start]);

  useEffect(() => {
    if (!selectedBinding) {
      if (!editingBindingId) setLocatedBindingId(null);
      return;
    }
    if (
      !visibleBindings.some(
        (binding) => binding.id === selectedBinding.id,
      )
    ) {
      setParameterQuery("");
      setParameterDirection("all");
      return;
    }
    setLocatedBindingId(selectedBinding.id);
    setSelectedParameterId(selectedBinding.id);
    setLeftSidebarTab("parameters");
    if (!editingBindingId) {
      setInspectorTab("parameter");
    }
    scrollParameterRow(selectedBinding.id);
  }, [
    editingBindingId,
    scrollParameterRow,
    selectedBinding,
    visibleBindings,
  ]);

  useEffect(() => {
    if (visibleBindings.length === 0) {
      setSelectedParameterId(null);
      return;
    }
    if (
      !selectedParameterId ||
      !visibleBindings.some(
        (binding) => binding.id === selectedParameterId,
      )
    ) {
      setSelectedParameterId(visibleBindings[0].id);
    }
  }, [selectedParameterId, visibleBindings]);

  const updateFile = useCallback((filePath: string, content: string) => {
    setFiles((current) =>
      current.map((file) =>
        file.path === filePath
          ? { ...file, content, size: new Blob([content]).size }
          : file,
      ),
    );
    setOutputs([]);
  }, []);

  const mergeImportedFiles = (
    imported: LaunchFile[],
    rejected: string[] = [],
    sourceLabel = "已导入",
  ) => {
    if (imported.length === 0) {
      setNotice({
        tone: "error",
        text: rejected.join("；") || "没有可导入的文件。",
      });
      return;
    }

    const importedByPath = new Map(
      imported.map((file) => [file.path, file]),
    );
    let nextFiles = files.map((file) => {
      const replacement = importedByPath.get(file.path);
      if (!replacement) return file;
      importedByPath.delete(file.path);
      return {
        ...file,
        content: replacement.content,
        flavor: sourceFlavorFromFilename(file.name),
        size: replacement.size,
      };
    });
    nextFiles = [...nextFiles, ...importedByPath.values()];
    setFiles(nextFiles);

    const activeReplacement = activeFile
      ? nextFiles.find((file) => file.path === activeFile.path)
      : null;
    setActiveFilePath(
      activeReplacement?.path ?? nextFiles[0]?.path ?? null,
    );
    setOutputs([]);
    setRuntimeResult(null);
    const replaced = imported.filter((file) =>
      files.some((existing) => existing.path === file.path),
    ).length;
    setNotice({
      tone: rejected.length > 0 ? "neutral" : "success",
      text: [
        `${sourceLabel} ${imported.length} 个文件`,
        replaced > 0 ? `更新 ${replaced} 个同名文件` : "",
        ...rejected,
      ]
        .filter(Boolean)
        .join("；"),
    });
  };

  const importFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const imported: LaunchFile[] = [];
    const rejected: string[] = [];

    for (const file of Array.from(fileList)) {
      if (file.size > MAX_FILE_SIZE) {
        rejected.push(`${file.name}：超过 8 MB`);
        continue;
      }
      const raw = await file.text();
      if (raw.includes("\u0000")) {
        rejected.push(`${file.name}：包含二进制内容`);
        continue;
      }
      imported.push(
        createLaunchFile(
          (
            file as File & {
              webkitRelativePath?: string;
            }
          ).webkitRelativePath || file.name,
          normalizeSourceText(raw),
        ),
      );
    }

    mergeImportedFiles(imported, rejected);
  };

  const openFiles = async () => {
    if (!desktopApi) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const selected = await desktopApi.selectFiles();
      const imported = selected.map((file) =>
        createLaunchFile(
          file.path,
          normalizeSourceText(file.content),
        ),
      );
      mergeImportedFiles(imported, [], "已从本机载入");
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error) });
    }
  };

  const loadFa1Example = () => {
    try {
      const example = buildFa1Example();
      setFiles(example.files);
      setActiveFilePath(example.files[0]?.path ?? null);
      setSelection({ start: 0, end: 0 });
      setBindings(example.bindings);
      setSelectedParameterId(example.bindings[0]?.id ?? null);
      setLocatedBindingId(example.bindings[0]?.id ?? null);
      if (example.bindings[0]) {
        scrollParameterRow(example.bindings[0].id);
      }
      setProgram(example.program);
      setArgumentText(example.arguments);
      setWorkingDirectory(example.workingDirectory);
      setOutputs([]);
      setLeftSidebarTab("parameters");
      setInspectorTab("parameter");
      const firstFile = example.files[0];
      const firstBinding = firstFile
        ? example.bindings.find(
            (binding) => binding.filePath === firstFile.path,
          )
        : null;
      if (firstFile && firstBinding) {
        const resolved = resolveLaunchBinding(
          firstFile.content,
          firstBinding.locator,
        );
        setPendingRange({
          filePath: firstFile.path,
          range: { start: resolved.start, end: resolved.end },
          select: false,
        });
      }
      setNotice({
        tone: "success",
        text: `已加载“${example.name}”：${example.files.length} 个路径文件，${example.bindings.length} 个标准参数。`,
      });
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error) });
    }
  };

  const saveProjectFolder = async (
    requestedMode: "auto" | "save" | "saveAs" = "auto",
  ) => {
    if (!desktopApi) {
      setNotice({
        tone: "neutral",
        text: "目录式工程仅在桌面客户端中可用。",
      });
      return null;
    }
    try {
      const mode =
        requestedMode === "save" && !projectPath
          ? "saveAs"
          : requestedMode === "auto"
            ? projectPath
              ? "save"
              : "saveAs"
            : requestedMode;
      const payload: ProjectFolderPayload = serializeProjectFolder({
        name: projectName,
        program,
        arguments: argumentText,
        workingDirectory,
        files,
        bindings,
        createdAt: projectCreatedAt ?? undefined,
      });
      const saved = await desktopApi.saveProject(
        payload,
        mode === "save"
          ? { mode: "save", path: projectPath ?? undefined }
          : { mode: "saveAs" },
      );
      if (!saved) return null;
      setProjectName(payload.manifest.name);
      setProjectPath(saved.path);
      setProjectRelativeFilePaths(
        Object.fromEntries(
          payload.manifest.files.map((file) => [
            file.path,
            file.relativePath,
          ]),
        ),
      );
      setProjectCreatedAt(payload.manifest.createdAt);
      setSavedRevision(
        projectRevision({
          name: payload.manifest.name,
          program,
          arguments: argumentText,
          workingDirectory,
          files,
          bindings,
        }),
      );
      setNotice({
        tone: "success",
        text:
          mode === "save"
            ? `工程已保存：${saved.path}`
            : `工程已另存为：${saved.path}`,
      });
      return { payload, path: saved.path };
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error) });
      return null;
    }
  };

  const openProjectFolder = async () => {
    if (!desktopApi) {
      setNotice({
        tone: "neutral",
        text: "目录式工程仅在桌面客户端中可用。",
      });
      return;
    }
    try {
      const raw = await desktopApi.openProject();
      if (!raw) return;
      const parsed = parseProjectFolder(raw);
      const folderPath =
        raw &&
        typeof raw === "object" &&
        "folderPath" in raw &&
        typeof raw.folderPath === "string"
          ? raw.folderPath
          : null;
      setProjectName(parsed.manifest.name);
      setProjectPath(folderPath);
      setProjectRelativeFilePaths(
        Object.fromEntries(
          parsed.manifest.files.map((file, index) => [
            parsed.files[index]?.path ?? file.path,
            file.relativePath,
          ]),
        ),
      );
      setProjectCreatedAt(parsed.manifest.createdAt);
      setFiles(parsed.files);
      setBindings(parsed.bindings);
      setSelectedParameterId(parsed.bindings[0]?.id ?? null);
      setLocatedBindingId(parsed.bindings[0]?.id ?? null);
      if (parsed.bindings[0]) {
        scrollParameterRow(parsed.bindings[0].id);
      }
      setProgram(parsed.launch.program);
      setArgumentText(parsed.launch.arguments);
      setWorkingDirectory(parsed.launch.workingDirectory);
      setActiveFilePath(parsed.files[0]?.path ?? null);
      setSelection({ start: 0, end: 0 });
      setOutputs([]);
      setRuntimeResult(null);
      setEditingBindingId(null);
      setLeftSidebarTab("parameters");
      setInspectorTab("parameter");
      setSavedRevision(
        projectRevision({
          name: parsed.manifest.name,
          program: parsed.launch.program,
          arguments: parsed.launch.arguments,
          workingDirectory: parsed.launch.workingDirectory,
          files: parsed.files,
          bindings: parsed.bindings,
        }),
      );
      const firstFile = parsed.files[0];
      const firstBinding = firstFile
        ? parsed.bindings.find(
            (binding) => binding.filePath === firstFile.path,
          )
        : null;
      if (firstFile && firstBinding) {
        const resolved = resolveLaunchBinding(
          firstFile.content,
          firstBinding.locator,
        );
        setPendingRange({
          filePath: firstFile.path,
          range: { start: resolved.start, end: resolved.end },
          select: false,
        });
      }
      setNotice({
        tone: "success",
        text: `已加载工程“${parsed.manifest.name}”：${parsed.files.length} 个文件，${parsed.bindings.length} 个参数。`,
      });
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error) });
    }
  };

  const removeFile = (filePath: string) => {
    const nextFiles = files.filter((file) => file.path !== filePath);
    setFiles(nextFiles);
    setProjectRelativeFilePaths((current) => {
      const next = { ...current };
      delete next[filePath];
      return next;
    });
    setBindings((current) =>
      current.filter((binding) => binding.filePath !== filePath),
    );
    setOutputs([]);
    if (activeFilePath === filePath) {
      setActiveFilePath(nextFiles[0]?.path ?? null);
      setSelection({ start: 0, end: 0 });
    }
  };

  const moveFile = (previousPath: string, requestedPath: string) => {
    const nextPath = requestedPath.trim();
    if (!nextPath || nextPath === previousPath) return;
    if (files.some((file) => file.path === nextPath)) {
      setNotice({
        tone: "error",
        text: `文件路径已存在：${nextPath}`,
      });
      return;
    }
    const slash = Math.max(
      nextPath.lastIndexOf("/"),
      nextPath.lastIndexOf("\\"),
    );
    const nextName = nextPath.slice(slash + 1) || nextPath;
    setFiles((current) =>
      current.map((file) =>
        file.path === previousPath
          ? {
              ...file,
              path: nextPath,
              name: nextName,
              flavor: sourceFlavorFromFilename(nextPath),
            }
          : file,
      ),
    );
    setBindings((current) =>
      current.map((binding) =>
        binding.filePath === previousPath
          ? { ...binding, filePath: nextPath }
          : binding,
      ),
    );
    if (activeFilePath === previousPath) {
      setActiveFilePath(nextPath);
    }
    setProjectRelativeFilePaths((current) => {
      const relativePath = current[previousPath];
      if (!relativePath) return current;
      const next = { ...current, [nextPath]: relativePath };
      delete next[previousPath];
      return next;
    });
    setNotice({ tone: "success", text: `文件路径已更新为 ${nextPath}` });
  };

  const addBinding = (
    direction: LaunchBindingDirection,
    bindingRange = selection,
  ) => {
    if (!activeFile) return;
    try {
      const bindingId = makeId("binding");
      const selectedMode =
        LOCATOR_MODES.find((mode) => mode.value === locatorMode)?.label ??
        locatorMode;
      const created =
        locatorMode === "auto"
          ? createBindingFromSelection(
              activeFile,
              bindingRange,
              direction,
              bindingId,
            )
          : createBindingFromLocator(
              activeFile,
              createLocatorForMode(locatorMode, locatorModeValues),
              direction,
              bindingId,
              selectedMode,
            );
      const nextBinding = {
        ...created,
        name: bindingName(created.name, direction, bindings),
      };
      setBindings((current) => [...current, nextBinding]);
      setLocatedBindingId(nextBinding.id);
      setSelectedParameterId(nextBinding.id);
      setLeftSidebarTab("parameters");
      setInspectorTab("parameter");
      setLayout((current) =>
        current.leftCollapsed
          ? { ...current, leftCollapsed: false }
          : current,
      );
      scrollParameterRow(nextBinding.id);
      setOutputs([]);
      setNotice({
        tone: "success",
        text:
          direction === "input"
            ? `已生成输入参数“${nextBinding.name}”。`
            : `已生成输出参数“${nextBinding.name}”。`,
      });
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error) });
    }
  };

  const handleEditorContextMenu = (
    request: EditorContextMenuRequest,
  ) => {
    setSelection(request.range);
    setEditorContextMenu({
      x: Math.max(8, Math.min(request.x, window.innerWidth - 232)),
      y: Math.max(8, Math.min(request.y, window.innerHeight - 132)),
      range: request.range,
    });
  };

  const updateBinding = (
    bindingId: string,
    changes: Partial<
      Pick<
        LaunchBinding,
        | "name"
        | "value"
        | "parameterType"
        | "defaultValue"
        | "unit"
        | "description"
      >
    >,
  ) => {
    setBindings((current) =>
      current.map((binding) =>
        binding.id === bindingId ? { ...binding, ...changes } : binding,
      ),
    );
    setOutputs([]);
  };

  const removeBinding = (bindingId: string) => {
    setBindings((current) =>
      current.filter((binding) => binding.id !== bindingId),
    );
    const nextSelection = bindings.find(
      (binding) => binding.id !== bindingId,
    );
    if (selectedParameterId === bindingId) {
      setSelectedParameterId(nextSelection?.id ?? null);
    }
    if (locatedBindingId === bindingId) {
      setLocatedBindingId(nextSelection?.id ?? null);
    }
    setOutputs([]);
  };

  const locateBinding = (binding: LaunchBinding) => {
    const file = files.find(
      (candidate) => candidate.path === binding.filePath,
    );
    if (!file) {
      setNotice({ tone: "error", text: "绑定文件已不存在。" });
      return;
    }
    try {
      const resolved = resolveLaunchBinding(
        file.content,
        binding.locator,
      );
      setActiveFilePath(file.path);
      setSelectedParameterId(binding.id);
      setLocatedBindingId(binding.id);
      setLeftSidebarTab("parameters");
      setInspectorTab("parameter");
      setPendingRange({
        filePath: file.path,
        range: { start: resolved.start, end: resolved.end },
      });
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error) });
    }
  };

  const beginEditLocator = (binding: LaunchBinding) => {
    const editorState = locatorEditorState(binding.locator);
    setEditingBindingId(binding.id);
    setLocatorMode(editorState.mode);
    setLocatorModeValues(editorState.values);
    setSelection({ start: 0, end: 0 });
    setLeftSidebarTab("parameters");
    setInspectorTab("locator");
    const file = filesByPath.get(binding.filePath);
    if (!file) {
      setNotice({ tone: "error", text: "绑定文件已不存在。" });
      return;
    }
    try {
      const resolved = resolveLaunchBinding(file.content, binding.locator);
      setActiveFilePath(file.path);
      setLocatedBindingId(binding.id);
      setSelectedParameterId(binding.id);
      setPendingRange({
        filePath: file.path,
        range: { start: resolved.start, end: resolved.end },
        select: false,
      });
      setNotice({
        tone: "neutral",
        text: `正在修改“${binding.name}”：请在编辑器拖选新内容，然后应用定位。`,
      });
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error) });
    }
  };

  const cancelLocatorEdit = () => {
    setEditingBindingId(null);
    setLocatorMode("auto");
  };

  const applyLocatorEdit = () => {
    if (!editingBindingId) return;
    const binding = bindings.find(
      (candidate) => candidate.id === editingBindingId,
    );
    const file = binding
      ? filesByPath.get(binding.filePath)
      : null;
    if (!binding || !file) {
      setNotice({ tone: "error", text: "待修改参数或文件已不存在。" });
      return;
    }
    try {
      const locator =
        locatorMode === "auto" && selection.end > selection.start
          ? createAutoPositionLocator(file, selection)
          : locatorMode === "auto"
          ? ({
              kind: "autoPosition",
              startRowIndex: locatorModeValues.startRowIndex ?? 1,
              startColumnIndex: locatorModeValues.startColumnIndex ?? 0,
              endRowIndex:
                locatorModeValues.endRowIndex ??
                locatorModeValues.startRowIndex ??
                1,
              endColumnIndex:
                locatorModeValues.endColumnIndex ??
                locatorModeValues.startColumnIndex ??
                0,
            } satisfies LaunchLocator)
          : createLocatorForMode(locatorMode, locatorModeValues);
      const resolved = resolveLaunchBinding(file.content, locator);
      setBindings((current) =>
        current.map((candidate) =>
          candidate.id === binding.id
            ? {
                ...candidate,
                locator,
                value:
                  candidate.direction === "input"
                    ? resolved.value
                    : candidate.value,
              }
            : candidate,
        ),
      );
      setOutputs([]);
      setEditingBindingId(null);
      setLocatedBindingId(binding.id);
      setSelectedParameterId(binding.id);
      setInspectorTab("parameter");
      scrollParameterRow(binding.id);
      setNotice({
        tone: "success",
        text: `已更新参数“${binding.name}”的定位。`,
      });
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error) });
    }
  };

  const handleEditorDoubleClick = (position: number) => {
    if (!activeFile) return;
    const candidate = activeBindings
      .flatMap((binding) => {
        try {
          const resolved = resolveLaunchBinding(
            activeFile.content,
            binding.locator,
          );
          if (
            position < resolved.start ||
            position > resolved.end
          ) {
            return [];
          }
          return [
            {
              binding,
              length: resolved.end - resolved.start,
            },
          ];
        } catch {
          return [];
        }
      })
      .sort((first, second) => first.length - second.length)[0]?.binding;
    if (!candidate) return;
    setParameterQuery("");
    setParameterDirection("all");
    setLocatedBindingId(candidate.id);
    setSelectedParameterId(candidate.id);
    setLeftSidebarTab("parameters");
    setInspectorTab("parameter");
    scrollParameterRow(candidate.id);
  };

  const writeAllInputs = async () => {
    setLeftSidebarTab("parameters");
    setInspectorTab("parameter");
    let nextFiles = files;
    let nextBindings = bindings;
    let writeCount = 0;
    const errors: string[] = [];

    for (const file of files) {
      const fileBindings = nextBindings.filter(
        (binding) => binding.filePath === file.path,
      );
      if (
        !fileBindings.some((binding) => binding.direction === "input")
      ) {
        continue;
      }
      const result = writeInputBindings(
        file.content,
        fileBindings,
      );
      if (result.errors.length > 0) {
        errors.push(
          ...result.errors.map(
            (error) =>
              `${file.name} / ${
                bindings.find(
                  (binding) => binding.id === error.bindingId,
                )?.name ?? "参数"
              }：${error.message}`,
          ),
        );
        continue;
      }
      writeCount += result.writtenBindingIds.length;
      nextFiles = nextFiles.map((candidate) =>
        candidate.path === file.path
          ? {
              ...candidate,
              content: result.source,
              size: new Blob([result.source]).size,
            }
          : candidate,
      );
      const updatedById = new Map(
        result.bindings.map((binding) => [binding.id, binding]),
      );
      nextBindings = nextBindings.map(
        (binding) => updatedById.get(binding.id) ?? binding,
      );
    }

    if (writeCount > 0) {
      setFiles(nextFiles);
      setBindings(nextBindings);
      setOutputs([]);
    }
    if (errors.length > 0) {
      setNotice({
        tone: "error",
        text: `${errors.join("；")}${
          writeCount > 0 ? `；其余 ${writeCount} 个输入已写回。` : ""
        }`,
      });
      return false;
    } else if (writeCount === 0) {
      setNotice({ tone: "neutral", text: "当前没有输入参数需要写回。" });
      return true;
    } else {
      setNotice({
        tone: "success",
        text: `已把 ${writeCount} 个输入值写入编辑器；运行工程时只修改生成工程副本。`,
      });
      return true;
    }
  };

  const runProgram = async () => {
    if (!desktopApi) {
      setNotice({
        tone: "neutral",
        text: "程序执行仅在桌面客户端中可用。浏览器预览模式只能生成命令。",
      });
      return;
    }
    if (!program.trim()) {
      setNotice({ tone: "error", text: "请先填写程序路径。" });
      return;
    }
    try {
      const wroteInputs = await writeAllInputs();
      if (!wroteInputs) return;
      const saved = await saveProjectFolder("auto");
      if (!saved) return;
      const runtimeProject = parseProjectFolder({
        ...saved.payload,
        folderPath: saved.path,
      });
      const overrides: ProjectInputOverride[] = runtimeProject.bindings
        .filter((binding) => binding.direction === "input")
        .map((binding) => ({
          target: "bindingId",
          bindingId: binding.id,
          value: binding.value,
        }));

      setLayout((current) =>
        current.dockCollapsed
          ? { ...current, dockCollapsed: false }
          : current,
      );
      setIsRunning(true);
      setRuntimeResult(null);
      setNotice({ tone: "neutral", text: "程序已启动，正在等待退出..." });
      const result = await executeProjectWithOverrides({
        snapshot: {
          program: runtimeProject.launch.program,
          arguments: runtimeProject.launch.arguments,
          workingDirectory: runtimeProject.launch.workingDirectory,
          files: runtimeProject.files,
          bindings: runtimeProject.bindings,
        },
        overrides,
        adapter: createDesktopExecutionAdapter(desktopApi, {
          writableRoot: saved.path,
        }),
        timeoutMs: 10 * 60 * 1000,
      });
      setRuntimeResult(result.runtime);
      setOutputs(result.outputs);

      if (result.runtime.status !== "completed") {
        setNotice({
          tone: "error",
          text: result.runtime.error
            ? `程序运行失败：${result.runtime.error}`
            : `程序退出码：${result.runtime.exitCode ?? "unknown"}`,
        });
        return;
      }

      const failed = result.outputs.filter((output) => output.error);
      setNotice({
        tone: failed.length > 0 ? "neutral" : "success",
        text:
          failed.length > 0
            ? `程序已完成；提取 ${result.outputs.length - failed.length} 个输出，${failed.length} 个失败。`
            : `程序已完成，已从生成工程提取 ${result.outputs.length} 个输出参数。`,
      });
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error) });
    } finally {
      setIsRunning(false);
    }
  };

  const copyCommand = async () => {
    if (!commandPreview || commandPreview.startsWith("参数错误")) {
      setNotice({ tone: "error", text: "请先配置有效的程序和参数。" });
      return;
    }
    try {
      await navigator.clipboard.writeText(commandPreview);
      setNotice({ tone: "success", text: "启动命令已复制到剪贴板。" });
    } catch {
      setNotice({
        tone: "error",
        text: "浏览器拒绝了剪贴板访问，请手动选择命令复制。",
      });
    }
  };

  const handleFileInput = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const input = event.currentTarget;
    void importFiles(input.files).finally(() => {
      input.value = "";
    });
  };

  const updateLocatorValue = <K extends keyof LocatorModeValues>(
    key: K,
    value: LocatorModeValues[K],
  ) => {
    setLocatorModeValues((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const locatorRequiresSelection = locatorMode === "auto";

  const requestOpenProject = () => {
    if (isDirty) {
      setConfirmOpenProject(true);
      return;
    }
    void openProjectFolder();
  };

  const changeTheme = (preference: ThemePreference) => {
    setThemePreference(preference);
    themeMenuRef.current?.removeAttribute("open");
  };

  const beginResize = (
    target: "left" | "right" | "dock",
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const initial = layout;
    document.body.classList.add("is-resizing");

    const handleMove = (moveEvent: PointerEvent) => {
      if (target === "left") {
        setLayout((current) => ({
          ...current,
          leftWidth: Math.min(
            360,
            Math.max(200, initial.leftWidth + moveEvent.clientX - startX),
          ),
        }));
      } else if (target === "right") {
        setLayout((current) => ({
          ...current,
          rightWidth: Math.min(
            460,
            Math.max(280, initial.rightWidth - moveEvent.clientX + startX),
          ),
        }));
      } else {
        setLayout((current) => ({
          ...current,
          dockHeight: Math.min(
            480,
            Math.max(180, initial.dockHeight - moveEvent.clientY + startY),
          ),
        }));
      }
    };

    const handleUp = () => {
      document.body.classList.remove("is-resizing");
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const resizeWithKeyboard = (
    target: "left" | "right" | "dock",
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    const delta = 16;
    if (target === "left") {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      setLayout((current) => ({
        ...current,
        leftWidth: Math.min(
          360,
          Math.max(
            200,
            current.leftWidth + (event.key === "ArrowRight" ? delta : -delta),
          ),
        ),
      }));
      return;
    }
    if (target === "right") {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      setLayout((current) => ({
        ...current,
        rightWidth: Math.min(
          460,
          Math.max(
            280,
            current.rightWidth + (event.key === "ArrowLeft" ? delta : -delta),
          ),
        ),
      }));
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    setLayout((current) => ({
      ...current,
      dockHeight: Math.min(
        480,
        Math.max(
          180,
          current.dockHeight + (event.key === "ArrowUp" ? delta : -delta),
        ),
      ),
    }));
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "o") {
        event.preventDefault();
        if (event.shiftKey) {
          requestOpenProject();
        } else {
          void openFiles();
        }
        return;
      }
      if (key === "s") {
        event.preventDefault();
        void saveProjectFolder(event.shiftKey ? "saveAs" : "auto");
        return;
      }
      if (key === "enter") {
        event.preventDefault();
        if (event.shiftKey) {
          void runProgram();
        } else if (
          !(event.target instanceof HTMLElement) ||
          !event.target.closest(".cm-editor")
        ) {
          addBinding("input");
        }
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  const toggleTreeGroup = (key: string) => {
    setCollapsedTreeKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const moveParameterTreeFocus = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
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
  };

  const moveTabFocus = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (
      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
    ) {
      return;
    }
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
  };

  const parameterTreeContent = (
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
              onClick={() => toggleTreeGroup(fileKey)}
              onKeyDown={(event) => {
                if (
                  (event.key === "ArrowLeft" && !fileCollapsed) ||
                  (event.key === "ArrowRight" && fileCollapsed)
                ) {
                  event.preventDefault();
                  toggleTreeGroup(fileKey);
                  return;
                }
                moveParameterTreeFocus(event);
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
                    direction === "input"
                      ? group.inputs
                      : group.outputs;
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
                        onClick={() => toggleTreeGroup(directionKey)}
                        onKeyDown={(event) => {
                          if (
                            (event.key === "ArrowLeft" &&
                              !directionCollapsed) ||
                            (event.key === "ArrowRight" &&
                              directionCollapsed)
                          ) {
                            event.preventDefault();
                            toggleTreeGroup(directionKey);
                            return;
                          }
                          moveParameterTreeFocus(event);
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
                        <div
                          className="runner-parameter-items"
                          role="group"
                        >
                          {items.map((binding) => {
                            const parameterOutput = outputsById.get(
                              binding.id,
                            );
                            return (
                              <button
                                aria-label={`${
                                  binding.direction === "input"
                                    ? "输入"
                                    : "输出"
                                }参数 ${binding.name}`}
                                aria-selected={
                                  binding.id === selectedParameter?.id
                                }
                                className={`runner-binding is-${binding.direction}${
                                  parameterOutput?.error
                                    ? " has-error"
                                    : ""
                                }${
                                  binding.id === locatedBindingId
                                    ? " is-located"
                                    : ""
                                }${
                                  binding.id === selectedParameter?.id
                                    ? " is-selected"
                                    : ""
                                }`}
                                data-binding-id={binding.id}
                                key={binding.id}
                                onClick={() => locateBinding(binding)}
                                onKeyDown={moveParameterTreeFocus}
                                role="treeitem"
                                title={`${binding.filePath}\n${locatorLabel(
                                  binding,
                                )}`}
                                type="button"
                              >
                                <span className="tree-parameter-glyph">
                                  ↳
                                </span>
                                <span>{binding.name}</span>
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
  );

  const parameterPropertiesContent = !selectedParameter ? (
    <div className="runner-parameter-property-empty">
      <strong>未选择参数</strong>
      <p>从左侧参数列表选择一项以查看和编辑属性。</p>
    </div>
  ) : (
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
              updateBinding(selectedParameter.id, {
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
              updateBinding(selectedParameter.id, {
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
        <label className="runner-property-field">
          <span>方向</span>
          <input
            aria-label="参数方向"
            disabled
            value={
              selectedParameter.direction === "input" ? "输入" : "输出"
            }
          />
        </label>
        <label className="runner-property-field">
          <span>单位</span>
          <input
            aria-label="参数单位"
            onChange={(event) =>
              updateBinding(selectedParameter.id, {
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
              updateBinding(selectedParameter.id, {
                defaultValue: event.target.value,
              })
            }
            rows={2}
            value={selectedParameter.defaultValue}
          />
        </label>
        <label className="runner-property-field is-wide">
          <span>
            {selectedParameter.direction === "input"
              ? "当前值"
              : "输出值"}
          </span>
          {selectedParameter.direction === "input" ? (
            <>
              <textarea
                aria-invalid={
                  selectedParameterValueError ? "true" : undefined
                }
                aria-label="当前输入值"
                className={`runner-binding-value${
                  selectedParameterValueError ? " is-invalid" : ""
                }`}
                onChange={(event) =>
                  updateBinding(selectedParameter.id, {
                    value: event.target.value,
                  })
                }
                rows={2}
                value={selectedParameter.value}
              />
              {selectedParameterValueError && (
                <small className="runner-property-error">
                  {selectedParameterValueError}
                </small>
              )}
            </>
          ) : (
            <div
              className="runner-output-value runner-property-readonly"
              title={selectedParameterOutput?.error ?? undefined}
            >
              <span>
                {selectedParameterOutput?.value ?? "等待提取"}
              </span>
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
                className="runner-binding-meta"
                title={locatorLabel(selectedParameter)}
              >
                {locatorLabel(selectedParameter)}
              </span>
              <button
                aria-label={`修改 ${selectedParameter.name} 定位`}
                onClick={() => beginEditLocator(selectedParameter)}
                type="button"
              >
                修改定位
              </button>
            </div>
            <dl className="runner-property-locator-details">
              {locatorDetails(selectedParameter.locator).map((detail) => (
                <div key={detail.label}>
                  <dt>{detail.label}</dt>
                  <dd>{detail.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
        <label className="runner-property-field is-wide">
          <span>备注</span>
          <textarea
            aria-label="参数备注"
            onChange={(event) =>
              updateBinding(selectedParameter.id, {
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
              updateBinding(selectedParameter.id, {
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
          onClick={() => locateBinding(selectedParameter)}
          type="button"
        >
          定位原文
        </button>
        <button
          aria-label={`删除 ${selectedParameter.name}`}
          className="is-danger"
          onClick={() => removeBinding(selectedParameter.id)}
          type="button"
        >
          删除参数
        </button>
      </div>
    </>
  );

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
                onChange={(event) => setProjectName(event.target.value)}
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
              aria-label={layout.leftCollapsed ? "展开文件面板" : "收起文件面板"}
              className="toolbar-icon-button"
              onClick={() =>
                setLayout((current) => ({
                  ...current,
                  leftCollapsed: !current.leftCollapsed,
                }))
              }
              title={layout.leftCollapsed ? "展开文件面板" : "收起文件面板"}
              type="button"
            >
              <PanelIcon />
            </button>
            <button
              disabled={!desktopApi}
              onClick={requestOpenProject}
              title={desktopApi ? "打开工程目录" : "仅在桌面客户端中可用"}
              type="button"
            >
              <FolderIcon />
              <span>打开工程</span>
            </button>
            <button
              aria-label="保存工程"
              disabled={!desktopApi}
              onClick={() => void saveProjectFolder("auto")}
              title={desktopApi ? "保存工程目录" : "仅在桌面客户端中可用"}
              type="button"
            >
              <SaveIcon />
              <span>保存</span>
            </button>
            <button
              disabled={!desktopApi}
              onClick={() => void saveProjectFolder("saveAs")}
              title={desktopApi ? "另存到新的工程目录" : "仅在桌面客户端中可用"}
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
                  onClick={() => changeTheme("system")}
                  role="menuitemradio"
                  type="button"
                >
                  <MonitorIcon />
                  跟随系统
                </button>
                <button
                  aria-checked={themePreference === "light"}
                  onClick={() => changeTheme("light")}
                  role="menuitemradio"
                  type="button"
                >
                  <SunIcon />
                  亮色
                </button>
                <button
                  aria-checked={themePreference === "dark"}
                  onClick={() => changeTheme("dark")}
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
              onClick={() => {
                setInspectorDrawerOpen((current) => !current);
                setLayout((current) => ({
                  ...current,
                  rightCollapsed: false,
                }));
              }}
              title="切换检查器"
              type="button"
            >
              <PanelIcon />
              <span>检查器</span>
            </button>
            <button
              className="toolbar-run-button"
              disabled={
                !desktopApi ||
                isRunning ||
                !program.trim() ||
                commandPreview.startsWith("参数错误")
              }
              onClick={() => void runProgram()}
              title={desktopApi ? "运行程序" : "仅在桌面客户端中可用"}
              type="button"
            >
              <PlayIcon />
              <span>{isRunning ? "运行中…" : "运行程序"}</span>
            </button>
          </div>
        </header>

        <div className="runner-layout">
          <aside
            className={`runner-files${
              layout.leftCollapsed ? " is-collapsed" : ""
            }`}
            aria-label="资源与参数"
          >
            <div className="runner-panel-heading">
              <div>
                <span>
                  {leftSidebarTab === "files" ? "资源" : "参数"}
                </span>
                <strong>
                  {leftSidebarTab === "files"
                    ? `${files.length} 个文件`
                    : `${visibleBindings.length} 个参数`}
                </strong>
              </div>
              {leftSidebarTab === "files" && (
                <button
                  aria-label="导入文件"
                  className="runner-icon-button"
                  onClick={() => void openFiles()}
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
                aria-selected={leftSidebarTab === "files"}
                className={leftSidebarTab === "files" ? "is-active" : ""}
                onClick={() => setLeftSidebarTab("files")}
                onKeyDown={moveTabFocus}
                role="tab"
                tabIndex={leftSidebarTab === "files" ? 0 : -1}
                type="button"
              >
                资源
              </button>
              <button
                aria-selected={leftSidebarTab === "parameters"}
                className={
                  leftSidebarTab === "parameters" ? "is-active" : ""
                }
                onClick={() => setLeftSidebarTab("parameters")}
                onKeyDown={moveTabFocus}
                role="tab"
                tabIndex={leftSidebarTab === "parameters" ? 0 : -1}
                type="button"
              >
                参数
                <small>{bindings.length}</small>
              </button>
            </div>
            <input
              className="file-input"
              multiple
              onChange={handleFileInput}
              ref={fileInputRef}
              type="file"
            />
            {leftSidebarTab === "files" ? (
              <>
                <button
                  className="runner-load-example"
                  onClick={loadFa1Example}
                  type="button"
                >
                  加载 fa1 标准示例
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
                        file.path === activeFile?.path ? " is-active" : ""
                      }`}
                      key={file.path}
                    >
                      <button
                        className="runner-file-select"
                        onClick={() => {
                          setActiveFilePath(file.path);
                          setSelection({ start: 0, end: 0 });
                        }}
                        type="button"
                      >
                        <span>
                          {file.name.slice(
                            file.name.lastIndexOf(".") + 1,
                          ) || "TXT"}
                        </span>
                        <strong title={file.path}>{file.path}</strong>
                        <small>{formatBytes(file.size)}</small>
                      </button>
                      <div className="runner-file-actions">
                        <button
                          aria-label={`移除 ${file.name}`}
                          onClick={() => removeFile(file.path)}
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
                    onChange={(event) =>
                      setParameterQuery(event.target.value)
                    }
                    placeholder="搜索参数、类型或备注"
                    type="search"
                    value={parameterQuery}
                  />
                  <select
                    aria-label="参数方向筛选"
                    onChange={(event) =>
                      setParameterDirection(
                        event.target.value as
                          | "all"
                          | LaunchBindingDirection,
                      )
                    }
                    value={parameterDirection}
                  >
                    <option value="all">全部方向</option>
                    <option value="input">仅输入</option>
                    <option value="output">仅输出</option>
                  </select>
                </div>
                {parameterTreeContent}
              </div>
            )}
          </aside>

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
                    moveFile(activeFile.path, event.currentTarget.value)
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
                  highlightRanges={editorHighlightRanges}
                  onChange={(content) =>
                    updateFile(activeFile.path, content)
                  }
                  onEditorContextMenu={handleEditorContextMenu}
                  onLocateShortcut={() => addBinding("input")}
                  onSelectionChange={setSelection}
                  onValueDoubleClick={handleEditorDoubleClick}
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
                  <p>
                    导入文本文件，在原文中选择内容并绑定输入或输出参数。
                  </p>
                  <div className="empty-actions">
                    <button
                      onClick={() => void openFiles()}
                      type="button"
                    >
                      <AddIcon />
                      导入文本文件
                    </button>
                    <button
                      disabled={!desktopApi}
                      onClick={requestOpenProject}
                      type="button"
                    >
                      <FolderIcon />
                      打开工程
                    </button>
                    <button onClick={loadFa1Example} type="button">
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
              {(editingBinding || selectedBinding) && (
                <small
                  title={
                    editingBinding
                      ? `正在重新定位：${editingBinding.name}`
                      : `已定位参数：${selectedBinding?.name ?? ""}`
                  }
                >
                  {editingBinding
                    ? `重新定位 · ${editingBinding.name}`
                    : `已定位 · ${selectedBinding?.name ?? ""}`}
                </small>
              )}
              <span className="runner-binding-context-hint">
                选中内容后右键添加参数
              </span>
            </div>
          </div>

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

          <aside
            className={`runner-controls${
              layout.rightCollapsed ? " is-collapsed" : ""
            }`}
            aria-label="检查器"
          >
            <div className="runner-panel-heading">
              <div>
                <span>检查器</span>
                <strong>
                  {inspectorTab === "parameter"
                    ? "参数属性"
                    : inspectorTab === "launch"
                      ? "启动配置"
                      : "定位规则"}
                </strong>
              </div>
              <button
                aria-label="关闭检查器"
                className="runner-icon-button"
                onClick={() => {
                  setLayout((current) => ({
                    ...current,
                    rightCollapsed: true,
                  }));
                  setInspectorDrawerOpen(false);
                }}
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
                aria-selected={inspectorTab === "parameter"}
                className={inspectorTab === "parameter" ? "is-active" : ""}
                onClick={() => setInspectorTab("parameter")}
                onKeyDown={moveTabFocus}
                role="tab"
                tabIndex={inspectorTab === "parameter" ? 0 : -1}
                type="button"
              >
                参数属性
              </button>
              <button
                aria-selected={inspectorTab === "launch"}
                className={inspectorTab === "launch" ? "is-active" : ""}
                onClick={() => setInspectorTab("launch")}
                onKeyDown={moveTabFocus}
                role="tab"
                tabIndex={inspectorTab === "launch" ? 0 : -1}
                type="button"
              >
                启动配置
              </button>
              <button
                aria-selected={inspectorTab === "locator"}
                className={inspectorTab === "locator" ? "is-active" : ""}
                onClick={() => setInspectorTab("locator")}
                onKeyDown={moveTabFocus}
                role="tab"
                tabIndex={inspectorTab === "locator" ? 0 : -1}
                type="button"
              >
                定位规则
              </button>
            </div>

            {inspectorTab === "parameter" && (
              <section className="runner-parameter-properties">
                {parameterPropertiesContent}
              </section>
            )}

            {inspectorTab === "launch" && (
              <div className="runner-inspector-scroll">
                <label className="runner-field">
                  <span>程序路径</span>
                  <input
                    onChange={(event) => setProgram(event.target.value)}
                    placeholder="例如 C:\Tools\solver.exe"
                    value={program}
                  />
                </label>
                <label className="runner-field">
                  <span>参数</span>
                  <textarea
                    onChange={(event) => setArgumentText(event.target.value)}
                    placeholder={'--input "case.ccl" --param {{输入参数}}'}
                    rows={3}
                    value={argumentText}
                  />
                  <small>参数中的 {"{{参数名}}"} 会替换为绑定值。</small>
                </label>
                <label className="runner-field">
                  <span>工作目录（备注）</span>
                  <input
                    onChange={(event) =>
                      setWorkingDirectory(event.target.value)
                    }
                    placeholder="C:\Projects\case"
                    value={workingDirectory}
                  />
                </label>
              </div>
            )}

            {inspectorTab === "locator" && (
            <div
              className={`runner-locator-mode${
                editingBindingId ? " is-editing" : ""
              }`}
            >
              <div className="runner-locator-heading">
                <div>
                  <span>定位规则</span>
                  <strong>识别模式</strong>
                </div>
                <small>
                  {editingBinding
                    ? `正在修改：${editingBinding.name}`
                    : locatorRequiresSelection
                      ? "按当前选区自动识别"
                      : "按模式参数独立定位"}
                </small>
              </div>
              <label className="runner-field">
                <select
                  aria-label="识别模式"
                  onChange={(event) =>
                    setLocatorMode(
                      event.target.value as LaunchLocatorMode,
                    )
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
                  {(locatorMode === "auto" ||
                    locatorMode === "fixedLength") && (
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
                            updateLocatorValue(
                              "separator",
                              event.target.value,
                            )
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
                        updateLocatorValue(
                          "startMarker",
                          event.target.value,
                        )
                      }
                      placeholder="例如 RESULT_BEGIN"
                      value={locatorModeValues.startMarker ?? ""}
                    />
                  </label>
                  <label className="runner-field">
                    <span>结束标记</span>
                    <input
                      onChange={(event) =>
                        updateLocatorValue(
                          "endMarker",
                          event.target.value,
                        )
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

              {(locatorMode === "indefiniteLine" ||
                locatorMode === "pattern") && (
                <label className="runner-field">
                  <span>出现序号</span>
                  <input
                    min="0"
                    onChange={(event) =>
                      updateLocatorValue(
                        "occurrence",
                        Number(event.target.value),
                      )
                    }
                    type="number"
                    value={locatorModeValues.occurrence ?? 0}
                  />
                </label>
              )}

              <p className="runner-mode-hint">
                {editingBindingId
                  ? "在编辑器拖选新内容会自动更新起始行列；点击“应用定位”保存。"
                  : locatorMode === "auto"
                    ? "自动记录选区行列；单行局部选区还会保存特殊字符 Token 相对边界。"
                    : "在编辑器中选中内容并右键，即可按当前模式创建绑定。"}
              </p>
              {locatorMode === "auto" && (
                <div
                  aria-label="自动定位 Token 预览"
                  className="runner-token-preview"
                >
                  <div className="runner-token-preview-heading">
                    <span>
                      {autoTokenRangePreview
                        ? "当前选区"
                        : visibleAutoTokenRange
                          ? "当前参数"
                          : "Token 预览"}
                    </span>
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
              {editingBindingId && (
                <div className="runner-locator-edit-actions">
                  <button
                    className="runner-locator-apply"
                    onClick={applyLocatorEdit}
                    type="button"
                  >
                    应用定位
                  </button>
                  <button
                    className="runner-locator-cancel"
                    onClick={cancelLocatorEdit}
                    type="button"
                  >
                    取消
                  </button>
                </div>
              )}
            </div>
            )}

          </aside>
        </div>

        <div
          aria-label="调整底部面板高度"
          aria-orientation="horizontal"
          className="dock-resizer"
          onDoubleClick={() =>
            setLayout((current) => ({
              ...current,
              dockHeight: DEFAULT_LAYOUT.dockHeight,
              dockCollapsed: false,
            }))
          }
          onKeyDown={(event) => resizeWithKeyboard("dock", event)}
          onPointerDown={(event) => beginResize("dock", event)}
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
          <div className="dock-summary">
            <span>{files.length} 个文件</span>
            <span>{inputs.length} 个输入</span>
            <span>{outputBindings.length} 个输出</span>
          </div>
          <button
            aria-label={layout.dockCollapsed ? "展开底部面板" : "收起底部面板"}
            className="dock-collapse-button"
            onClick={() =>
              setLayout((current) => ({
                ...current,
                dockCollapsed: !current.dockCollapsed,
              }))
            }
            title={layout.dockCollapsed ? "展开底部面板" : "收起底部面板"}
            type="button"
          >
            {layout.dockCollapsed ? "⌃" : "⌄"}
          </button>
        </div>

        <div
          className={`runner-command-area${
            layout.dockCollapsed ? " is-panel-hidden" : ""
          }`}
        >
          <div className="runner-command-heading">
            <div>
              <span>命令预览</span>
              <strong>启动命令</strong>
            </div>
            <small>
              {desktopApi
                ? "桌面客户端可直接启动程序并刷新输出文件。"
                : "浏览器预览仅生成命令；桌面客户端可直接运行程序。"}
            </small>
          </div>
          <pre aria-live="polite">
            {commandPreview ||
              "填写程序路径后，这里会生成可复制的启动命令。"}
          </pre>
          <div className="runner-command-actions">
            <button
              className="runner-run-button"
              disabled={
                !desktopApi ||
                isRunning ||
                !program.trim() ||
                commandPreview.startsWith("参数错误")
              }
              onClick={() => void runProgram()}
              title={
                desktopApi
                  ? "运行程序"
                  : "仅在桌面客户端中可用"
              }
              type="button"
            >
              <PlayIcon />
              {isRunning ? "运行中…" : "运行程序"}
            </button>
            <button
              disabled={!commandPreview || commandPreview.startsWith("参数错误")}
              onClick={copyCommand}
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
                  {runtimeResult.status === "completed"
                    ? "运行完成"
                    : runtimeResult.status === "timeout"
                      ? "运行超时"
                      : "运行失败"}
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
            </div>
          )}
          {!runtimeResult && (
            <div className="runner-run-empty">
              <span className={isRunning ? "is-running" : ""} />
              <strong>{isRunning ? "程序运行中" : "等待运行"}</strong>
              <p>
                {isRunning
                  ? "程序完成后会自动刷新绑定文件并提取输出参数。"
                  : "配置程序路径和参数后，使用工具栏中的“运行程序”。"}
              </p>
            </div>
          )}
        </div>

        <footer className="app-statusbar" aria-label="应用状态">
          <span className="status-mode">
            <i />
            {desktopApi ? "本机模式" : "浏览器预览"}
          </span>
          <span className="status-path" title={projectPath ?? ""}>
            {projectPath ?? "未保存工程"}
          </span>
          <span className="status-spacer" />
          {isDirty && <span className="status-dirty">未保存</span>}
          <span>{files.length} 文件</span>
          <span>{inputs.length} 输入</span>
          <span>{outputBindings.length} 输出</span>
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
              locatorMode === "auto" &&
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
              locatorMode === "auto" &&
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
