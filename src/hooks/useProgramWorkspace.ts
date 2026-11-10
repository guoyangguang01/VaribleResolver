import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import {
  DEFAULT_LAYOUT,
  useWorkbenchLayout,
} from "../hooks/useWorkbenchLayout";
import { useThemePreference } from "../hooks/useThemePreference";
import type { InspectorTab } from "../components/program/InspectorPanel";
import type {
  EditorContextMenuRequest,
  SourceEditorHandle,
} from "../components/SourceEditor";
import {
  relocateBindingsAfterEdit,
  type SourceEditorChange,
} from "../lib/relocation";
import {
  LauncherError,
  FREE_PARAMETER_SCOPE,
  buildLaunchCommand,
  createBindingFromSelection,
  createLaunchFile,
  createLocatorForMode,
  extractOutputBindings,
  interpolateArguments,
  isFileBinding,
  isFreeBinding,
  parseCommandArguments,
  parameterFileName,
  parameterKey,
  resolveInputReferences,
  resolveLaunchBinding,
  validateParameterValue,
  type FileLaunchBinding,
  type LaunchBinding,
  type LaunchBindingDirection,
  type LaunchFile,
  type LaunchLocatorMode,
  type LocatorModeValues,
  type OutputExtraction,
} from "../lib/launcher";
import {
  lineNumberAt,
  normalizeSourceText,
  sourceFlavorFromFilename,
  type SourceRange,
} from "../lib/variables";
import {
  parseProjectFolder,
  serializeProjectFolder,
  type ProjectFolderPayload,
  type ProjectLaunchMode,
  type ProjectOutputSpec,
} from "../lib/projectFolder";
import type { ThemePreference } from "../lib/theme";
import {
  executeProjectWithOverrides,
  type ProjectInputOverride,
} from "../lib/projectExecution";
import { createDesktopExecutionAdapter } from "../lib/desktopExecutionAdapter";
import {
  bindingName,
  errorMessage,
  locatorEditorState,
  locatorLabel,
  projectRevision,
  remapParameterReference,
  remapReferenceFile,
  selectionScore,
} from "../lib/programWorkspace";

const MAX_FILE_SIZE = 8 * 1024 * 1024;
const EMPTY_PROJECT_NAME = "未命名工程";
const DEFAULT_LOCATOR_MODE_VALUES: LocatorModeValues = {
  startRowIndex: 1,
  startColumnIndex: 0,
  endRowIndex: 1,
  endColumnIndex: 0,
  fieldIndex: 0,
  captureGroup: 0,
  occurrence: 0,
};
const EMPTY_PROJECT_REVISION = projectRevision({
  name: EMPTY_PROJECT_NAME,
  program: "",
  arguments: "",
  workingDirectory: "",
  launchMode: "direct",
  outputs: undefined,
  files: [],
  bindings: [],
});
type NoticeTone = "neutral" | "success" | "error";
type PendingProjectAction = "new" | "open";
type ParsedProjectFolder = ReturnType<typeof parseProjectFolder>;

type LeftSidebarTab = "files" | "parameters";

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

export function useProgramWorkspace() {

  const { layout, setLayout, beginResize, resizeWithKeyboard } =
    useWorkbenchLayout();
  const {
    themePreference,
    setThemePreference,
    resolvedTheme,
  } = useThemePreference();
  const [files, setFiles] = useState<LaunchFile[]>([]);
  const [projectName, setProjectName] = useState(EMPTY_PROJECT_NAME);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [isBuiltInProject, setIsBuiltInProject] = useState(false);
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
  const [launchMode, setLaunchMode] =
    useState<ProjectLaunchMode>("direct");
  const [projectOutputs, setProjectOutputs] =
    useState<ProjectOutputSpec[] | undefined>(undefined);
  const [locatorMode, setLocatorMode] =
    useState<LaunchLocatorMode>("auto");
  const [editingBindingId, setEditingBindingId] = useState<string | null>(
    null,
  );
  const [locatorModeValues, setLocatorModeValues] =
    useState<LocatorModeValues>(() => ({ ...DEFAULT_LOCATOR_MODE_VALUES }));
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
  const [leftSidebarTab, setLeftSidebarTab] =
    useState<LeftSidebarTab>("files");
  const [inspectorTab, setInspectorTab] =
    useState<InspectorTab>("launch");
  const [inspectorDrawerOpen, setInspectorDrawerOpen] = useState(false);
  const [pendingProjectAction, setPendingProjectAction] =
    useState<PendingProjectAction | null>(null);
  const [savedRevision, setSavedRevision] = useState(
    EMPTY_PROJECT_REVISION,
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<SourceEditorHandle>(null);
  const editorContextMenuRef = useRef<HTMLDivElement>(null);
  const themeMenuRef = useRef<HTMLDetailsElement>(null);
  const defaultProjectLoadStartedRef = useRef(false);
  const desktopApi = window.programStudio;
  const currentRevision = useMemo(
    () =>
      projectRevision({
        name: projectName,
        program,
        arguments: argumentText,
        workingDirectory,
        launchMode,
        outputs: projectOutputs,
        files,
        bindings,
      }),
    [
      argumentText,
      bindings,
      files,
      launchMode,
      projectOutputs,
      program,
      projectName,
      workingDirectory,
    ],
  );
  const isDirty = currentRevision !== savedRevision;

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
            (binding): binding is FileLaunchBinding =>
              isFileBinding(binding) &&
              binding.filePath === activeFile.path,
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
  const filesByPath = useMemo(
    () => new Map(files.map((file) => [file.path, file])),
    [files],
  );
  const outputsByParameterKey = useMemo(
    () =>
      new Map(
        outputs.map((output) => [output.parameterKey, output]),
      ),
    [outputs],
  );
  const editingBinding = bindings.find(
    (binding) => parameterKey(binding) === editingBindingId,
  );
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
      return `${binding.name} ${
        isFileBinding(binding)
          ? binding.filePath
          : FREE_PARAMETER_SCOPE
      } ${
        binding.inputReference ?? ""
      } ${binding.parameterType} ${binding.defaultValue} ${
        binding.unit
      } ${binding.description} ${locatorLabel(binding)}`
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
        (binding) =>
          isFileBinding(binding) && binding.filePath === file.path,
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
      (binding) =>
        isFileBinding(binding) && !knownPaths.has(binding.filePath),
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
    const freeBindings = visibleBindings.filter(isFreeBinding);
    if (freeBindings.length > 0) {
      groups.push({
        path: "__free__",
        name: FREE_PARAMETER_SCOPE,
        inputs: freeBindings,
        outputs: [],
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
      (binding) => parameterKey(binding) === selectedParameterId,
    ) ??
    visibleBindings[0] ??
    null;
  const selectedParameterFile = selectedParameter
    ? isFileBinding(selectedParameter)
      ? filesByPath.get(selectedParameter.filePath)
      : null
    : null;
  const selectedParameterFileLabel = !selectedParameter
    ? ""
    : isFreeBinding(selectedParameter)
      ? FREE_PARAMETER_SCOPE
      : (projectRelativeFilePaths[selectedParameter.filePath] ??
        selectedParameterFile?.name ??
        "未封装文件");
  const selectedParameterOutput = selectedParameter
    ? outputsByParameterKey.get(parameterKey(selectedParameter))
    : null;
  const inputReferenceResolution = useMemo(
    () => resolveInputReferences(bindings),
    [bindings],
  );
  const selectedParameterValueError =
    selectedParameter &&
    (selectedParameter.direction === "input" ||
      isFreeBinding(selectedParameter))
      ? inputReferenceResolution.errors.get(
          parameterKey(selectedParameter),
        ) ??
        (() => {
          const root = inputReferenceResolution.roots.get(
            parameterKey(selectedParameter),
          );
          return validateParameterValue(
            root?.parameterType ?? selectedParameter.parameterType,
            root?.value ?? selectedParameter.value,
          );
        })()
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
          if (binding.locatorInvalid) return [];
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
  const scrollParameterRow = useCallback((key: string) => {
    setLeftSidebarTab("parameters");
    setLayout((current) =>
      current.leftCollapsed
        ? { ...current, leftCollapsed: false }
        : current,
    );
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const row = document.querySelector<HTMLElement>(
          `[data-parameter-key="${CSS.escape(key)}"]`,
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
        if (binding.locatorInvalid) return [];
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
        (binding) =>
          parameterKey(binding) === parameterKey(selectedBinding),
      )
    ) {
      setParameterQuery("");
      setParameterDirection("all");
      return;
    }
    setLocatedBindingId(parameterKey(selectedBinding));
    setSelectedParameterId(parameterKey(selectedBinding));
    setLeftSidebarTab("parameters");
    if (!editingBindingId) {
      setInspectorTab("parameter");
    }
    scrollParameterRow(parameterKey(selectedBinding));
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
        (binding) => parameterKey(binding) === selectedParameterId,
      )
    ) {
      setSelectedParameterId(parameterKey(visibleBindings[0]));
    }
  }, [selectedParameterId, visibleBindings]);

  const updateFile = useCallback(
    (filePath: string, change: SourceEditorChange) => {
      const file = files.find(
        (candidate) => candidate.path === filePath,
      );
      if (!file) return;
      const relocated = relocateBindingsAfterEdit(
        filePath,
        file.content,
        change.value,
        change.changes,
        bindings,
      );
      setFiles((current) =>
        current.map((candidate) =>
          candidate.path === filePath
            ? {
                ...candidate,
                content: change.value,
                size: new Blob([change.value]).size,
              }
            : candidate,
        ),
      );
      setBindings(relocated.bindings);
      setOutputs([]);
      if (relocated.invalidatedParameterKeys.length > 0) {
        setNotice({
          tone: "error",
          text: `编辑导致 ${relocated.invalidatedParameterKeys.length} 个参数定位失效，请重新设置定位。`,
        });
      }
    },
    [bindings, files],
  );

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
        sourcePath: replacement.sourcePath,
        sourceContent: replacement.sourceContent,
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
          file.path,
        ),
      );
      mergeImportedFiles(imported, [], "已从本机载入");
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error) });
    }
  };

  const startNewProject = () => {
    if (isRunning) {
      setNotice({
        tone: "error",
        text: "程序运行中，无法新建工程。请等待当前运行结束。",
      });
      return;
    }
    setFiles([]);
    setProjectName(EMPTY_PROJECT_NAME);
    setProjectPath(null);
    setIsBuiltInProject(false);
    setProjectRelativeFilePaths({});
    setProjectCreatedAt(null);
    setActiveFilePath(null);
    setSelection({ start: 0, end: 0 });
    setBindings([]);
    setProgram("");
    setArgumentText("");
    setWorkingDirectory("");
    setLaunchMode("direct");
    setProjectOutputs(undefined);
    setLocatorMode("auto");
    setEditingBindingId(null);
    setLocatorModeValues({ ...DEFAULT_LOCATOR_MODE_VALUES });
    setParameterQuery("");
    setParameterDirection("all");
    setCollapsedTreeKeys(new Set());
    setLocatedBindingId(null);
    setSelectedParameterId(null);
    setOutputs([]);
    setRuntimeResult(null);
    setPendingRange(null);
    setEditorContextMenu(null);
    setLeftSidebarTab("files");
    setInspectorTab("launch");
    setInspectorDrawerOpen(false);
    setPendingProjectAction(null);
    setSavedRevision(EMPTY_PROJECT_REVISION);
    setNotice({
      tone: "success",
      text: "已新建空白工程。导入文件或添加参数后保存，即可创建工程目录。",
    });
  };

  const requestNewProject = () => {
    if (isRunning) {
      setNotice({
        tone: "error",
        text: "程序运行中，无法新建工程。请等待当前运行结束。",
      });
      return;
    }
    if (isDirty) {
      setPendingProjectAction("new");
      return;
    }
    startNewProject();
  };

  const applyLoadedProject = (
    parsed: ParsedProjectFolder,
    folderPath: string | null,
    builtIn: boolean,
    noticeText: string,
  ) => {
    const loadedFiles = builtIn
      ? parsed.files.map((file) => ({
          path: file.path,
          name: file.name,
          content: file.content,
          flavor: file.flavor,
          size: file.size,
        }))
      : parsed.files;
    setProjectName(parsed.manifest.name);
    setProjectPath(folderPath);
    setIsBuiltInProject(builtIn);
    setProjectRelativeFilePaths(
      Object.fromEntries(
        parsed.manifest.files.map((file, index) => [
          parsed.files[index]?.path ?? file.path,
          file.relativePath,
        ]),
      ),
    );
    setProjectCreatedAt(parsed.manifest.createdAt);
    setFiles(loadedFiles);
    setBindings(parsed.bindings);
    const firstKey = parsed.bindings[0]
      ? parameterKey(parsed.bindings[0])
      : null;
    setSelectedParameterId(firstKey);
    setLocatedBindingId(firstKey);
    if (parsed.bindings[0]) {
      scrollParameterRow(firstKey!);
    }
    setProgram(parsed.launch.program);
    setArgumentText(parsed.launch.arguments);
    setWorkingDirectory(parsed.launch.workingDirectory);
    setLaunchMode(parsed.launch.mode);
    setProjectOutputs(parsed.outputs);
    setActiveFilePath(loadedFiles[0]?.path ?? null);
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
        launchMode: parsed.launch.mode,
        outputs: parsed.outputs,
        files: loadedFiles,
        bindings: parsed.bindings,
      }),
    );
    const firstFile = loadedFiles[0];
    const firstBinding = firstFile
      ? parsed.bindings.find(
          (binding): binding is FileLaunchBinding =>
            isFileBinding(binding) &&
            binding.filePath === firstFile.path,
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
    setNotice({ tone: "success", text: noticeText });
  };

  const loadDefaultProject = async () => {
    if (!desktopApi) {
      setNotice({
        tone: "error",
        text: "Electron 桌面接口不可用，无法打开默认测试工程。",
      });
      return;
    }
    try {
      const raw = await desktopApi.openDefaultProject();
      const parsed = parseProjectFolder(raw);
      const folderPath =
        raw &&
        typeof raw === "object" &&
        "folderPath" in raw &&
        typeof raw.folderPath === "string"
          ? raw.folderPath
          : null;
      applyLoadedProject(
        parsed,
        folderPath,
        true,
        `已打开默认测试工程“${parsed.manifest.name}”：${parsed.files.length} 个路径文件，${parsed.bindings.length} 个标准参数。`,
      );
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error) });
    }
  };

  const loadFa1Example = () => {
    void loadDefaultProject();
  };

  useEffect(() => {
    if (defaultProjectLoadStartedRef.current) return;
    defaultProjectLoadStartedRef.current = true;
    void loadDefaultProject();
  }, []);

  const saveProjectFolder = async (
    requestedMode: "auto" | "save" | "saveAs" = "auto",
    options: { syncOriginalFiles?: boolean } = {},
  ) => {
    if (!desktopApi) {
      setNotice({
        tone: "neutral",
        text: "Electron 桌面接口不可用，请重新启动客户端。",
      });
      return null;
    }
    try {
      const mode =
        isBuiltInProject
          ? "saveAs"
          : requestedMode === "save" && !projectPath
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
        launchMode,
        outputs: projectOutputs,
        files,
        bindings,
        createdAt: projectCreatedAt ?? undefined,
      });
      const originalFileContents = new Map<string, string>();
      if (options.syncOriginalFiles ?? requestedMode !== "saveAs") {
        for (const file of files) {
          if (
            file.sourcePath &&
            file.content !== file.sourceContent
          ) {
            originalFileContents.set(file.sourcePath, file.content);
          }
        }
      }
      const saved = await desktopApi.saveProject(
        payload,
        mode === "save"
          ? { mode: "save", path: projectPath ?? undefined }
          : { mode: "saveAs" },
      );
      if (!saved) return null;
      setProjectName(payload.manifest.name);
      setProjectPath(saved.path);
      setIsBuiltInProject(false);
      setProjectRelativeFilePaths(
        Object.fromEntries(
          payload.manifest.files.map((file) => [
            file.path,
            file.relativePath,
          ]),
        ),
      );
      setProjectCreatedAt(payload.manifest.createdAt);
      let savedFiles = files;
      if (originalFileContents.size > 0) {
        try {
          await desktopApi.updateFiles(
            [...originalFileContents].map(([path, content]) => ({
              path,
              content,
            })),
          );
          savedFiles = files.map((file) => {
            const sourceContent = file.sourcePath
              ? originalFileContents.get(file.sourcePath)
              : undefined;
            return sourceContent === undefined
              ? file
              : { ...file, sourceContent };
          });
          setFiles(savedFiles);
        } catch (error) {
          setNotice({
            tone: "error",
            text: `工程已保存，但更新原文件失败：${errorMessage(error)}`,
          });
          return null;
        }
      }
      setSavedRevision(
        projectRevision({
          name: payload.manifest.name,
          program,
          arguments: argumentText,
          workingDirectory,
          launchMode,
          outputs: payload.outputs.outputs,
          files: savedFiles,
          bindings,
        }),
      );
      setProjectOutputs(payload.outputs.outputs);
      setNotice({
        tone: "success",
        text:
          mode === "save"
            ? originalFileContents.size > 0
              ? `工程已保存，已更新 ${originalFileContents.size} 个原文件：${saved.path}`
              : `工程已保存：${saved.path}`
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
        text: "Electron 桌面接口不可用，请重新启动客户端。",
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
      applyLoadedProject(
        parsed,
        folderPath,
        false,
        `已加载工程“${parsed.manifest.name}”：${parsed.files.length} 个文件，${parsed.bindings.length} 个参数。`,
      );
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
    const keyRemap = new Map(
      bindings
        .filter((binding) => binding.filePath === previousPath)
        .map((binding) => [
          parameterKey(binding),
          `${parameterFileName(nextPath)}.${binding.name}`,
        ]),
    );
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
      current.map((binding) => {
        if (!isFileBinding(binding)) {
          return {
            ...binding,
            inputReference: remapReferenceFile(
              binding.inputReference,
              previousPath,
              nextPath,
            ),
          };
        }
        return {
          ...binding,
          filePath:
            binding.filePath === previousPath
              ? nextPath
              : binding.filePath,
          inputReference: remapReferenceFile(
            binding.inputReference,
            previousPath,
            nextPath,
          ),
        };
      }),
    );
    const remapStateKey = (current: string | null) =>
      current ? (keyRemap.get(current) ?? current) : current;
    setSelectedParameterId(remapStateKey);
    setLocatedBindingId(remapStateKey);
    setEditingBindingId(remapStateKey);
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
      const created = createBindingFromSelection(
        activeFile,
        bindingRange,
        direction,
      );
      const nextBinding = {
        ...created,
        name: bindingName(
          created.name,
          direction,
          isFileBinding(created)
            ? created.filePath
            : FREE_PARAMETER_SCOPE,
          bindings,
        ),
      };
      setBindings((current) => [...current, nextBinding]);
      const nextKey = parameterKey(nextBinding);
      setLocatedBindingId(nextKey);
      setSelectedParameterId(nextKey);
      setLeftSidebarTab("parameters");
      setInspectorTab("parameter");
      setLayout((current) =>
        current.leftCollapsed
          ? { ...current, leftCollapsed: false }
          : current,
      );
      scrollParameterRow(nextKey);
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

  const addFreeParameter = (direction: LaunchBindingDirection) => {
    const name = bindingName(
      direction === "input" ? "自由输入" : "自由输出",
      direction,
      FREE_PARAMETER_SCOPE,
      bindings,
    );
    const binding: LaunchBinding = {
      scope: "free",
      name,
      direction,
      value: "",
      parameterType: "text",
      defaultValue: "",
      unit: "",
      description:
        direction === "input"
          ? "手动输入的运行参数，不关联文件。"
          : "手动赋值的输出参数，不执行文件提取。",
    };
    const key = parameterKey(binding);
    setBindings((current) => [...current, binding]);
    setSelectedParameterId(key);
    setLocatedBindingId(key);
    setParameterDirection("all");
    setParameterQuery("");
    setLeftSidebarTab("parameters");
    setInspectorTab("parameter");
    setLayout((current) =>
      current.leftCollapsed
        ? { ...current, leftCollapsed: false }
        : current,
    );
    scrollParameterRow(key);
    setNotice({
      tone: "success",
      text: `已添加${
        direction === "input" ? "自由输入" : "自由输出"
      }参数“${name}”。`,
    });
  };

  const updateBinding = (
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
  ) => {
    const currentBinding = bindings.find(
      (binding) => parameterKey(binding) === key,
    );
    if (
      currentBinding &&
      changes.name !== undefined &&
      bindings.some(
        (binding) =>
          binding !== currentBinding &&
          binding.filePath === currentBinding.filePath &&
          binding.name === changes.name,
      )
    ) {
      setNotice({
        tone: "error",
        text: `同一文件已存在参数“${changes.name}”。`,
      });
      return;
    }
    const nextKey = currentBinding
      ? parameterKey({ ...currentBinding, ...changes })
      : key;
    setBindings((current) =>
      current.map((binding) => {
        if (parameterKey(binding) === key) {
          return { ...binding, ...changes };
        }
        return currentBinding && changes.name !== undefined
          ? {
              ...binding,
              inputReference: remapParameterReference(
                binding.inputReference,
                isFileBinding(currentBinding)
                  ? currentBinding.filePath
                  : FREE_PARAMETER_SCOPE,
                isFileBinding(currentBinding)
                  ? currentBinding.filePath
                  : FREE_PARAMETER_SCOPE,
                currentBinding.name,
                changes.name,
              ),
              outputReference: remapParameterReference(
                binding.outputReference,
                isFileBinding(currentBinding)
                  ? currentBinding.filePath
                  : FREE_PARAMETER_SCOPE,
                isFileBinding(currentBinding)
                  ? currentBinding.filePath
                  : FREE_PARAMETER_SCOPE,
                currentBinding.name,
                changes.name,
              ),
            }
          : binding;
      }),
    );
    setSelectedParameterId((current) =>
      current === key ? nextKey : current,
    );
    setLocatedBindingId((current) =>
      current === key ? nextKey : current,
    );
    setEditingBindingId((current) =>
      current === key ? nextKey : current,
    );
    setOutputs([]);
  };

  const removeBinding = (key: string) => {
    setBindings((current) =>
      current.filter((binding) => parameterKey(binding) !== key),
    );
    const nextSelection = bindings.find(
      (binding) => parameterKey(binding) !== key,
    );
    if (selectedParameterId === key) {
      setSelectedParameterId(
        nextSelection ? parameterKey(nextSelection) : null,
      );
    }
    if (locatedBindingId === key) {
      setLocatedBindingId(
        nextSelection ? parameterKey(nextSelection) : null,
      );
    }
    setOutputs([]);
  };

  const locateBinding = (binding: LaunchBinding) => {
    const key = parameterKey(binding);
    setSelectedParameterId(key);
    setLocatedBindingId(key);
    setInspectorTab("parameter");
    if (isFreeBinding(binding)) {
      setLeftSidebarTab("parameters");
      setNotice({
        tone: "neutral",
        text: `自由参数“${binding.name}”不关联文件，可直接在参数属性中赋值。`,
      });
      return;
    }
    const file = files.find(
      (candidate) => candidate.path === binding.filePath,
    );
    if (!file) {
      setNotice({ tone: "error", text: "绑定文件已不存在。" });
      return;
    }
    setActiveFilePath(file.path);
    if (binding.locatorInvalid) {
      setNotice({
        tone: "error",
        text: `参数“${binding.name}”的定位已失效，请点击“修改定位”重新设置。`,
      });
      return;
    }
    try {
      const resolved = resolveLaunchBinding(
        file.content,
        binding.locator,
      );
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
    if (isFreeBinding(binding)) {
      setSelectedParameterId(parameterKey(binding));
      setLocatedBindingId(parameterKey(binding));
      setInspectorTab("parameter");
      setNotice({
        tone: "neutral",
        text: `自由参数“${binding.name}”没有文件定位规则。`,
      });
      return;
    }
    const editorState = locatorEditorState(binding.locator);
    const key = parameterKey(binding);
    setEditingBindingId(key);
    setLocatorMode(editorState.mode);
    setLocatorModeValues(editorState.values);
    setSelection({ start: 0, end: 0 });
    setLeftSidebarTab("parameters");
    setInspectorTab("parameter");
    const file = filesByPath.get(binding.filePath);
    if (!file) {
      setNotice({ tone: "error", text: "绑定文件已不存在。" });
      return;
    }
    setActiveFilePath(file.path);
    setLocatedBindingId(key);
    setSelectedParameterId(key);
    if (binding.locatorInvalid) {
      setNotice({
        tone: "neutral",
        text: `正在重新设置“${binding.name}”：请在编辑器拖选新内容，然后应用定位。`,
      });
      return;
    }
    try {
      const resolved = resolveLaunchBinding(file.content, binding.locator);
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
      (candidate) => parameterKey(candidate) === editingBindingId,
    );
    const file = binding && isFileBinding(binding)
      ? filesByPath.get(binding.filePath)
      : null;
    if (!binding || !isFileBinding(binding) || !file) {
      setNotice({ tone: "error", text: "待修改参数或文件已不存在。" });
      return;
    }
    try {
      const locator = createLocatorForMode(
        locatorMode,
        locatorModeValues,
        { content: file.content, selection },
      );
      const resolved = resolveLaunchBinding(file.content, locator);
      setBindings((current) =>
        current.map((candidate) =>
          isFileBinding(candidate) &&
          parameterKey(candidate) === parameterKey(binding)
            ? {
                ...candidate,
                locator,
                locatorInvalid: undefined,
                locatorInvalidAnchor: undefined,
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
      const key = parameterKey(binding);
      setLocatedBindingId(key);
      setSelectedParameterId(key);
      setInspectorTab("parameter");
      scrollParameterRow(key);
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
        if (binding.locatorInvalid) return [];
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
    const candidateKey = parameterKey(candidate);
    setLocatedBindingId(candidateKey);
    setSelectedParameterId(candidateKey);
    setLeftSidebarTab("parameters");
    setInspectorTab("parameter");
    scrollParameterRow(candidateKey);
  };

  const runProgram = async () => {
    if (!desktopApi) {
      setNotice({
        tone: "neutral",
        text: "Electron 桌面接口不可用，请重新启动客户端。",
      });
      return;
    }
    if (!program.trim()) {
      setNotice({ tone: "error", text: "请先填写程序路径。" });
      return;
    }
    try {
      const saved = await saveProjectFolder("auto", {
        syncOriginalFiles: false,
      });
      if (!saved) return;
      const runWorkspace = await desktopApi.createRunWorkspace(saved.path);
      const runtimeProject = parseProjectFolder(
        {
          ...saved.payload,
          folderPath: runWorkspace.path,
        },
        { mode: "run" },
      );
      const overrides: ProjectInputOverride[] = runtimeProject.bindings
        .filter(
          (binding) =>
            binding.direction === "input" &&
            !binding.inputReference,
        )
        .map((binding) => ({
          fileName: isFreeBinding(binding)
            ? FREE_PARAMETER_SCOPE
            : parameterFileName(binding.filePath),
          parameterName: binding.name,
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
          launchMode: runtimeProject.launch.mode,
          environment: runtimeProject.launch.environment,
          files: runtimeProject.files,
          bindings: runtimeProject.bindings,
        },
        overrides,
        adapter: createDesktopExecutionAdapter(desktopApi, {
          writableRoot: runWorkspace.path,
        }),
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
            : `程序已完成，已从运行工作区提取 ${result.outputs.length} 个输出参数：${runWorkspace.path}`,
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
        text: "剪贴板访问失败，请手动选择命令复制。",
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

  const requestOpenProject = () => {
    if (isDirty) {
      setPendingProjectAction("open");
      return;
    }
    void openProjectFolder();
  };

  const cancelPendingProjectAction = () => {
    setPendingProjectAction(null);
  };

  const confirmPendingProjectAction = () => {
    const action = pendingProjectAction;
    setPendingProjectAction(null);
    if (action === "new") {
      startNewProject();
    } else if (action === "open") {
      void openProjectFolder();
    }
  };

  const changeTheme = (preference: ThemePreference) => {
    setThemePreference(preference);
    themeMenuRef.current?.removeAttribute("open");
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "n" && !event.shiftKey) {
        event.preventDefault();
        requestNewProject();
        return;
      }
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


  return {
    layout, setLayout, beginResize, resizeWithKeyboard, themePreference, resolvedTheme, themeMenuRef, changeTheme, files, projectName, setProjectName, projectPath, activeFilePath, setActiveFilePath, selection, setSelection, bindings, program, setProgram, argumentText, setArgumentText, workingDirectory, setWorkingDirectory, launchMode, setLaunchMode, locatorMode, setLocatorMode, editingBindingId, locatorModeValues, parameterQuery, setParameterQuery, parameterDirection, setParameterDirection, collapsedTreeKeys, setCollapsedTreeKeys, locatedBindingId, selectedParameterId, notice, setNotice, isRunning, runtimeResult, editorContextMenu, setEditorContextMenu, leftSidebarTab, setLeftSidebarTab, inspectorTab, setInspectorTab, inspectorDrawerOpen, setInspectorDrawerOpen, pendingProjectAction, fileInputRef, editorRef, editorContextMenuRef, isDirty, activeFile, selectedText, editorContextText, outputsByParameterKey, editingBinding, visibleBindings, parameterFileGroups, selectedParameter, selectedParameterFileLabel, selectedParameterOutput, inputReferenceResolution, selectedParameterValueError, commandPreview, selectedBinding, editorHighlightRanges, updateFile, openFiles, loadFa1Example, saveProjectFolder, requestNewProject, requestOpenProject, cancelPendingProjectAction, confirmPendingProjectAction, removeFile, moveFile, addBinding, handleEditorContextMenu, addFreeParameter, updateBinding, removeBinding, locateBinding, beginEditLocator, cancelLocatorEdit, applyLocatorEdit, handleEditorDoubleClick, runProgram, copyCommand, handleFileInput, updateLocatorValue, openProjectFolder,
  };
}
