import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import SourceEditor, {
  type SourceEditorHandle,
} from "./SourceEditor";
import {
  LauncherError,
  buildLaunchCommand,
  createBindingFromLocator,
  createBindingFromSelection,
  createLaunchFile,
  createLocatorForMode,
  extractOutputBindings,
  interpolateArguments,
  parseCommandArguments,
  resolveLaunchBinding,
  writeInputBindings,
  type LaunchBinding,
  type LaunchBindingDirection,
  type LaunchFile,
  type LaunchLocator,
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
import { buildFa1Example } from "../lib/fa1Example";
import {
  parseProjectFolder,
  serializeProjectFolder,
  type ProjectFolderPayload,
} from "../lib/projectFolder";

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

type NoticeTone = "neutral" | "success" | "error";

interface RunnerNotice {
  tone: NoticeTone;
  text: string;
}

interface PendingRange {
  filePath: string;
  range: SourceRange;
  select?: boolean;
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

function DownloadIcon() {
  return (
    <SmallIcon>
      <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
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
  const [locatedBindingId, setLocatedBindingId] = useState<string | null>(
    null,
  );
  const [notice, setNotice] = useState<RunnerNotice | null>(null);
  const [outputs, setOutputs] = useState<OutputExtraction[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [runtimeResult, setRuntimeResult] =
    useState<DesktopRunResult | null>(null);
  const [pendingRange, setPendingRange] = useState<PendingRange | null>(
    null,
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<SourceEditorHandle>(null);
  const desktopApi = window.programStudio;

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
      return `${binding.name} ${binding.filePath} ${locatorLabel(binding)}`
        .toLowerCase()
        .includes(query);
    });
  }, [bindings, parameterDirection, parameterQuery]);
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
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const row = document.querySelector<HTMLElement>(
          `[data-binding-id="${CSS.escape(bindingId)}"]`,
        );
        const body = row?.closest<HTMLElement>(".runner-parameter-body");
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
    scrollParameterRow(selectedBinding.id);
  }, [
    editingBindingId,
    scrollParameterRow,
    selectedBinding,
    visibleBindings,
  ]);

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
      setProgram(example.program);
      setArgumentText(example.arguments);
      setWorkingDirectory(example.workingDirectory);
      setOutputs([]);
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

  const saveProjectFolder = async () => {
    if (!desktopApi) {
      setNotice({
        tone: "neutral",
        text: "目录式工程仅在桌面客户端中可用。",
      });
      return;
    }
    try {
      const payload: ProjectFolderPayload = serializeProjectFolder({
        name: projectName,
        program,
        arguments: argumentText,
        workingDirectory,
        files,
        bindings,
        createdAt: projectCreatedAt ?? undefined,
      });
      const saved = await desktopApi.saveProject(payload);
      if (!saved) return;
      setProjectName(payload.manifest.name);
      setProjectPath(saved.path);
      setProjectCreatedAt(payload.manifest.createdAt);
      setNotice({
        tone: "success",
        text: `工程已保存：${saved.path}`,
      });
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error) });
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
      setProjectCreatedAt(parsed.manifest.createdAt);
      setFiles(parsed.files);
      setBindings(parsed.bindings);
      setProgram(parsed.launch.program);
      setArgumentText(parsed.launch.arguments);
      setWorkingDirectory(parsed.launch.workingDirectory);
      setActiveFilePath(parsed.files[0]?.path ?? null);
      setSelection({ start: 0, end: 0 });
      setOutputs([]);
      setRuntimeResult(null);
      setEditingBindingId(null);
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
    setNotice({ tone: "success", text: `文件路径已更新为 ${nextPath}` });
  };

  const addBinding = (direction: LaunchBindingDirection) => {
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
              selection,
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

  const updateBinding = (
    bindingId: string,
    changes: Partial<Pick<LaunchBinding, "name" | "value">>,
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
    const file = filesByPath.get(binding.filePath);
    if (!file) {
      setNotice({ tone: "error", text: "绑定文件已不存在。" });
      return;
    }
    try {
      const resolved = resolveLaunchBinding(file.content, binding.locator);
      setActiveFilePath(file.path);
      setLocatedBindingId(binding.id);
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
        locatorMode === "auto"
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
    scrollParameterRow(candidate.id);
  };

  const writeAllInputs = async () => {
    let nextFiles = files;
    let nextBindings = bindings;
    let writeCount = 0;
    const writtenPaths = new Set<string>();
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
      writtenPaths.add(file.path);
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
      if (desktopApi) {
        try {
          await desktopApi.writeFiles(
            nextFiles
              .filter((file) => writtenPaths.has(file.path))
              .map((file) => ({
                path: file.path,
                content: file.content,
              })),
          );
        } catch (error) {
          setNotice({
            tone: "error",
            text: `输入已更新到编辑器，但写入磁盘失败：${errorMessage(error)}`,
          });
          return false;
        }
      }
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
        text: desktopApi
          ? `已把 ${writeCount} 个输入值写入原文件。`
          : `已把 ${writeCount} 个输入值写回文本，可下载文件后运行命令。`,
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
      const args = interpolateArguments(
        parseCommandArguments(argumentText),
        bindings,
      );
      const wroteInputs = await writeAllInputs();
      if (!wroteInputs) return;

      setIsRunning(true);
      setRuntimeResult(null);
      setNotice({ tone: "neutral", text: "程序已启动，正在等待退出..." });
      const result = await desktopApi.runProgram({
        program: program.trim(),
        args,
        cwd: workingDirectory.trim() || undefined,
        timeoutMs: 10 * 60 * 1000,
      });
      setRuntimeResult(result);

      if (result.status !== "completed") {
        setNotice({
          tone: "error",
          text: result.error
            ? `程序运行失败：${result.error}`
            : `程序退出码：${result.exitCode ?? "unknown"}`,
        });
        return;
      }

      const paths = [
        ...new Set(bindings.map((binding) => binding.filePath)),
      ];
      const loaded = await desktopApi.readFiles(paths);
      const loadedByPath = new Map(
        loaded.map((file) => [file.path, file]),
      );
      const refreshedFiles = files.map((file) => {
        const diskFile = loadedByPath.get(file.path);
        return diskFile
          ? createLaunchFile(diskFile.path, diskFile.content)
          : file;
      });
      setFiles(refreshedFiles);
      const extracted = extractOutputBindings(refreshedFiles, bindings);
      setOutputs(extracted);
      const failed = extracted.filter((output) => output.error);
      setNotice({
        tone: failed.length > 0 ? "neutral" : "success",
        text:
          failed.length > 0
            ? `程序已完成；提取 ${extracted.length - failed.length} 个输出，${failed.length} 个失败。`
            : `程序已完成，已刷新文件并提取 ${extracted.length} 个输出参数。`,
      });
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error) });
    } finally {
      setIsRunning(false);
    }
  };

  const extractOutputs = () => {
    const result = extractOutputBindings(files, bindings);
    if (result.length === 0) {
      setNotice({ tone: "neutral", text: "当前没有输出参数。" });
      return;
    }
    setOutputs(result);
    const failures = result.filter((output) => output.error);
    setNotice(
      failures.length > 0
        ? {
            tone: "error",
            text: `已提取 ${result.length - failures.length} 个输出，${
              failures.length
            } 个失败：${failures
              .map((output) => `${output.name}（${output.error}）`)
              .join("；")}`,
          }
        : {
            tone: "success",
            text: `已提取 ${result.length} 个输出参数。`,
          },
    );
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

  const downloadFile = (file: LaunchFile) => {
    const url = URL.createObjectURL(
      new Blob([file.content], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    URL.revokeObjectURL(url);
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

  return (
    <section className="program-runner" id="program-runner">
      <div className="runner-intro">
        <div>
          <p className="eyebrow runner-eyebrow">
            <span>02</span>
            PROGRAM → PARAMETER
          </p>
          <h2>程序启动准备台</h2>
        </div>
        <p>
          引入多个文件，在原文中绑定输入和输出，生成启动命令。
          外部程序完成后再导入结果文件，输出参数会按原定位规则重新提取。
        </p>
      </div>

      <div className="runner-shell">
        <div className="runner-topbar" aria-label="工程工具栏">
          <div className="runner-service-state">
            <span className="status-light" />
            CLIENT WORKSPACE
            <small>本机工程</small>
          </div>
          <div className="runner-project-title">
            <span>PROJECT</span>
            <input
              aria-label="工程名称"
              onChange={(event) => setProjectName(event.target.value)}
              value={projectName}
            />
            <span className="runner-project-path" title={projectPath ?? ""}>
              {projectPath ?? "尚未保存到工程目录"}
            </span>
          </div>
          <div className="runner-project-actions">
            <button
              disabled={!desktopApi}
              onClick={() => void saveProjectFolder()}
              title={desktopApi ? "保存工程目录" : "仅在桌面客户端中可用"}
              type="button"
            >
              保存工程
            </button>
            <button
              disabled={!desktopApi}
              onClick={() => void openProjectFolder()}
              title={desktopApi ? "打开工程目录" : "仅在桌面客户端中可用"}
              type="button"
            >
              打开工程
            </button>
          </div>
          <div className="runner-counts">
            <span>{files.length} 文件</span>
            <span>{inputs.length} 输入</span>
            <span>{outputBindings.length} 输出</span>
          </div>
        </div>

        <div className="runner-layout">
          <aside className="runner-files" aria-label="程序文件">
            <div className="runner-panel-heading">
              <div>
                <span>FILES</span>
                <strong>输入文件</strong>
              </div>
              <button
                aria-label="导入文件"
                className="runner-icon-button"
                onClick={() => void openFiles()}
                type="button"
              >
                <AddIcon />
              </button>
            </div>
            <input
              className="file-input"
              multiple
              onChange={handleFileInput}
              ref={fileInputRef}
              type="file"
            />
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
                      {file.name.slice(file.name.lastIndexOf(".") + 1) || "TXT"}
                    </span>
                    <strong title={file.path}>{file.path}</strong>
                    <small>{formatBytes(file.size)}</small>
                  </button>
                  <div className="runner-file-actions">
                    <button
                      aria-label={`下载 ${file.name}`}
                      onClick={() => downloadFile(file)}
                      type="button"
                    >
                      <DownloadIcon />
                    </button>
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
          </aside>

          <div className="runner-editor-panel">
            <div className="runner-editor-heading">
              <div>
                <span>LOCATE IN SOURCE</span>
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
                <span>FILE PATH</span>
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
                  onLocateShortcut={() => addBinding("input")}
                  onSelectionChange={setSelection}
                  onValueDoubleClick={handleEditorDoubleClick}
                  ref={editorRef}
                  value={activeFile.content}
                />
              ) : (
                <div className="runner-editor-empty">
                  <span>FILE</span>
                  <strong>先导入一个文本文件</strong>
                  <p>选中值或任意片段即可按起始行列创建输入/输出绑定。</p>
                </div>
              )}
            </div>
            <div className="runner-selection-bar">
              <div>
                <span>SELECTED</span>
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
              <div className="runner-binding-actions">
                <button
                  disabled={locatorRequiresSelection && !selectedText}
                  onClick={() => addBinding("input")}
                  type="button"
                >
                  + 输入参数
                </button>
                <button
                  disabled={locatorRequiresSelection && !selectedText}
                  onClick={() => addBinding("output")}
                  type="button"
                >
                  + 输出参数
                </button>
              </div>
            </div>
          </div>

          <aside className="runner-controls">
            <div className="runner-panel-heading">
              <div>
                <span>LAUNCH PROFILE</span>
                <strong>程序配置</strong>
              </div>
            </div>
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
                onChange={(event) => setWorkingDirectory(event.target.value)}
                placeholder="C:\Projects\case"
                value={workingDirectory}
              />
            </label>

            <div
              className={`runner-locator-mode${
                editingBindingId ? " is-editing" : ""
              }`}
            >
              <div className="runner-locator-heading">
                <div>
                  <span>LOCATOR MODE</span>
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
                    ? "自动记录选区的起始行列和结束行列，不使用变量名或文本规则。"
                    : "点击下方“输入参数”或“输出参数”时按当前模式创建绑定。"}
              </p>
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

          </aside>
        </div>

        <section className="runner-parameter-panel" aria-label="输入输出参数">
          <div className="runner-parameter-toolbar">
            <div className="runner-parameter-title">
              <span>PARAMETER TABLE</span>
              <strong>输入与输出参数</strong>
              <small>
                显示 {visibleBindings.length} / {bindings.length}
              </small>
            </div>
            <div className="runner-parameter-filters">
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
              <input
                aria-label="搜索参数"
                onChange={(event) => setParameterQuery(event.target.value)}
                placeholder="搜索参数名、路径或定位模式"
                type="search"
                value={parameterQuery}
              />
            </div>
            <div className="runner-main-actions">
              <button
                className="runner-prepare-button"
                disabled={inputs.length === 0}
                onClick={writeAllInputs}
                type="button"
              >
                <PlayIcon />
                写回全部输入
              </button>
              <button
                className="runner-secondary-button"
                disabled={outputBindings.length === 0}
                onClick={extractOutputs}
                type="button"
              >
                提取输出参数
              </button>
            </div>
          </div>

          <div className="runner-parameter-table">
            <div className="runner-parameter-header" aria-hidden="true">
              <span>方向</span>
              <span>参数名</span>
              <span>文件</span>
              <span>识别模式</span>
              <span>当前值 / 输出值</span>
              <span>操作</span>
            </div>
            <div className="runner-parameter-body">
              {visibleBindings.length === 0 && (
                <p className="runner-parameter-empty">
                  没有符合条件的参数。调整筛选条件或在文件中新增输入/输出。
                </p>
              )}
              {visibleBindings.map((binding, index) => {
                const file = filesByPath.get(binding.filePath);
                const output = outputsById.get(binding.id);
                return (
                  <div
                    className={`runner-binding is-${binding.direction}${
                      output?.error ? " has-error" : ""
                    }${
                      binding.id === locatedBindingId
                        ? " is-located"
                        : ""
                    }`}
                    data-binding-id={binding.id}
                    key={binding.id}
                  >
                    <span className="runner-binding-direction">
                      {binding.direction === "input" ? "IN" : "OUT"}
                    </span>
                    <label className="runner-parameter-name">
                      <span>{String(index + 1).padStart(3, "0")}</span>
                      <input
                        aria-label="参数名"
                        onChange={(event) =>
                          updateBinding(binding.id, {
                            name: event.target.value,
                          })
                        }
                        title={binding.name}
                        value={binding.name}
                      />
                    </label>
                    <span
                      className="runner-parameter-file"
                      title={binding.filePath}
                    >
                      {file?.name ?? "文件缺失"}
                    </span>
                    <span
                      className="runner-binding-meta"
                      title={locatorLabel(binding)}
                    >
                      {locatorLabel(binding)}
                    </span>
                    <div
                      className="runner-parameter-value"
                      title={output?.error ?? undefined}
                    >
                      {binding.direction === "input" ? (
                        <input
                          aria-label={`${binding.name} 输入值`}
                          className="runner-binding-value"
                          onChange={(event) =>
                            updateBinding(binding.id, {
                              value: event.target.value,
                            })
                          }
                          value={binding.value}
                        />
                      ) : (
                        <div className="runner-output-value">
                          <span>
                            {output?.value ?? "等待提取"}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="runner-parameter-actions">
                      <button
                        aria-label={`修改 ${binding.name} 定位`}
                        onClick={() => beginEditLocator(binding)}
                        title="修改定位"
                        type="button"
                      >
                        ✎
                      </button>
                      <button
                        aria-label={`定位 ${binding.name}`}
                        onClick={() => locateBinding(binding)}
                        title="定位原文"
                        type="button"
                      >
                        ↗
                      </button>
                      <button
                        aria-label={`删除 ${binding.name}`}
                        onClick={() => removeBinding(binding.id)}
                        title="删除参数"
                        type="button"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <div className="runner-command-area">
          <div className="runner-command-heading">
            <div>
              <span>LAUNCH COMMAND</span>
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
            {activeFile && (
              <button
                onClick={() => downloadFile(activeFile)}
                type="button"
              >
                <DownloadIcon />
                下载当前文件
              </button>
            )}
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
        </div>

        <div className={`runner-notice is-${notice?.tone ?? "neutral"}`}>
          <span>{notice ? (notice.tone === "error" ? "!" : "✓") : "i"}</span>
          <p>
            {notice?.text ??
              "流程：选择本机文件 → 绑定参数 → 写回输入 → 运行程序 → 自动刷新文件 → 提取输出。"}
          </p>
        </div>
      </div>
    </section>
  );
}
