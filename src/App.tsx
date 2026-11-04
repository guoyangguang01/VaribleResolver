import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import SourceEditor, {
  type SourceEditorHandle,
} from "./components/SourceEditor";
import {
  detectSourceFlavor,
  findVariableAt,
  lineNumberAt,
  makeSnippet,
  normalizeSourceText,
  parseVariables,
  sourceFlavorFromFilename,
  type ParsedVariable,
  type SourceFlavor,
  type SourceRange,
} from "./lib/variables";
import workbenchSource from "../testData/workbench.wbjn?raw";

interface LoadedFile {
  name: string;
  content: string;
  flavor: SourceFlavor;
  size: number;
}

const DEFAULT_FILE: LoadedFile = {
  name: "workbench.wbjn",
  content: normalizeSourceText(workbenchSource),
  flavor: "workbench",
  size: normalizeSourceText(workbenchSource).length,
};

const SUPPORTED_FILE_EXTENSIONS = new Set([
  ".ccl",
  ".cse",
  ".py",
  ".wbjn",
  ".txt",
  ".json",
  ".csv",
  ".log",
  ".md",
  ".xml",
  ".yaml",
  ".yml",
  ".ini",
  ".cfg",
  ".conf",
]);
const FILE_ACCEPT = [...SUPPORTED_FILE_EXTENSIONS].join(",");
const MAX_FILE_SIZE = 8 * 1024 * 1024;

function isSupportedFile(file: File): boolean {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  return SUPPORTED_FILE_EXTENSIONS.has(extension);
}

function Icon({
  children,
  size = 18,
}: {
  children: ReactNode;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      {children}
    </svg>
  );
}

function SparkIcon() {
  return (
    <Icon size={17}>
      <path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z" stroke="currentColor" strokeLinejoin="round" />
      <path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" fill="currentColor" />
    </Icon>
  );
}

function LocateIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="6.5" stroke="currentColor" />
      <circle cx="12" cy="12" fill="currentColor" r="2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" strokeLinecap="round" />
    </Icon>
  );
}

function TrashIcon() {
  return (
    <Icon size={16}>
      <path d="M4 7h16M9 7V4h6v3M6.5 7l.8 13h9.4l.8-13M10 11v5M14 11v5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </Icon>
  );
}

function FileIcon() {
  return (
    <Icon size={16}>
      <path d="M6 3h7l5 5v13H6V3Z" stroke="currentColor" strokeLinejoin="round" />
      <path d="M13 3v6h5M9 13h6M9 17h6" stroke="currentColor" strokeLinecap="round" />
    </Icon>
  );
}

function App() {
  const [source, setSource] = useState(DEFAULT_FILE.content);
  const [loadedFile, setLoadedFile] = useState<LoadedFile | null>(DEFAULT_FILE);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [anchor, setAnchor] = useState({ start: 0, end: 0 });
  const [locatedRange, setLocatedRange] = useState<SourceRange | null>(null);
  const [generationNote, setGenerationNote] = useState<string | null>(null);
  const [variableResult, setVariableResult] =
    useState<ParsedVariable | null>(null);

  const editorRef = useRef<SourceEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeFlavor = detectSourceFlavor(source, loadedFile?.name);
  const selectedText = source.slice(selection.start, selection.end);
  const anchorText = source.slice(anchor.start, anchor.end);
  const parsedVariables = useMemo(
    () => parseVariables(source, activeFlavor),
    [activeFlavor, source],
  );
  const variableCandidate = useMemo(
    () =>
      findVariableAt(parsedVariables, selection.start) ??
      findVariableAt(parsedVariables, anchor.start),
    [anchor.start, parsedVariables, selection.start],
  );
  const canGenerate = Boolean(variableCandidate);

  const lineCount = useMemo(() => source.split("\n").length, [source]);

  useEffect(() => {
    if (selection.end <= selection.start) return;
    setVariableResult(variableCandidate);
    setLocatedRange(selection);
    setGenerationNote(
      variableCandidate
        ? "变量定位 · 当前划选内容已关联到变量。"
        : null,
    );
  }, [selection.end, selection.start, variableCandidate]);

  const handleEditorSelection = useCallback((range: SourceRange) => {
    setSelection(range);
    if (range.end > range.start) {
      setAnchor(range);
      setLocatedRange(range);
    }
  }, []);

  const handleSourceChange = (nextSource: string) => {
    setSource(nextSource);
    setVariableResult(null);
    setGenerationNote(null);
  };

  const importFile = async (file: File | null) => {
    if (!file) return;
    if (!isSupportedFile(file)) {
      setFileNotice("不支持该文件类型。");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setFileNotice("文件超过 8 MB，无法载入。");
      return;
    }

    try {
      const content = normalizeSourceText(await file.text());
      if (content.includes("\u0000")) {
        setFileNotice("检测到二进制内容，无法作为文本载入。");
        return;
      }

      const nextFile: LoadedFile = {
        name: file.name,
        content,
        flavor: sourceFlavorFromFilename(file.name),
        size: file.size,
      };
      setLoadedFile(nextFile);
      setSource(content);
      setSelection({ start: 0, end: 0 });
      setAnchor({ start: 0, end: 0 });
      setLocatedRange(null);
      setVariableResult(null);
      setGenerationNote(null);
      setFileNotice(`已载入 ${file.name}`);
      requestAnimationFrame(() => editorRef.current?.selectRange(0, 0));
    } catch {
      setFileNotice("文件读取失败，请检查编码或文件权限。");
    }
  };

  const selectRange = useCallback((start: number, end: number) => {
    setSelection({ start, end });
    setAnchor({ start, end });
    setLocatedRange({ start, end });
    editorRef.current?.selectRange(start, end);
  }, []);

  const generatePattern = () => {
    if (!variableCandidate) return;
    setVariableResult(variableCandidate);
    setGenerationNote(
      "变量定位 · 已关联选中内容并识别实际值。",
    );
    const range =
      selection.end > selection.start
        ? selection
        : locatedRange ?? variableCandidate.valueRange;
    selectRange(range.start, range.end);
  };

  const locateSelection = () => {
    if (!locatedRange) return;
    selectRange(locatedRange.start, locatedRange.end);
  };

  const clearSource = () => {
    setSource("");
    setSelection({ start: 0, end: 0 });
    setAnchor({ start: 0, end: 0 });
    setLocatedRange(null);
    setVariableResult(null);
    setGenerationNote(null);
    requestAnimationFrame(() => editorRef.current?.focus());
  };

  const loadSample = () => {
    setLoadedFile(DEFAULT_FILE);
    setFileNotice(null);
    setSource(DEFAULT_FILE.content);
    setSelection({ start: 0, end: 0 });
    setAnchor({ start: 0, end: 0 });
    setLocatedRange(null);
    setVariableResult(null);
    setGenerationNote(null);
    requestAnimationFrame(() => editorRef.current?.selectRange(0, 0));
  };

  const displaySelection = selectedText
    ? {
        text: selectedText,
        count: `${selectedText.length} 字符`,
        label: "当前选中",
      }
    : anchorText
      ? {
          text: anchorText,
          count: `${anchorText.length} 字符`,
          label: "上次定位",
        }
      : variableCandidate
        ? {
            text: `${variableCandidate.variableName} = ${variableCandidate.value}${
              variableCandidate.unit ? ` ${variableCandidate.unit}` : ""
            }`,
            count: `L${variableCandidate.line}`,
            label: "变量行候选",
          }
        : null;
  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="site-header">
        <a className="brand" href="#workspace" aria-label="Variable Studio 首页">
          <span className="brand-mark">V:</span>
          <span className="brand-name">
            Variable <strong>Studio</strong>
          </span>
        </a>
        <div className="privacy-note">
          <span className="privacy-dot" />
          本地运行 · 文本不会离开浏览器
        </div>
        <a className="header-link" href="#workspace">
          开始定位
          <span aria-hidden="true">↓</span>
        </a>
      </header>

      <main>
        <section className="intro">
          <div className="intro-copy">
            <p className="eyebrow">
              <span>01</span>
              VARIABLE → LOCATION
            </p>
            <h1>
              把变量赋值，
              <br />
              变成精准的<span>坐标。</span>
            </h1>
            <p className="intro-description">
              点击任意变量行，自动识别变量名、值与单位，
              并沿代码结构找到唯一路径和原文位置。
            </p>
          </div>
          <div className="intro-art" aria-hidden="true">
            <div className="art-card art-card-back">
              <span>target_body_name = "fati"</span>
            </div>
            <div className="art-card art-card-front">
              <span className="art-label">VARIABLE</span>
              <code>body.Material</code>
              <span className="art-arrow">↓</span>
              <small>1 unique location</small>
            </div>
            <span className="art-spark">✦</span>
          </div>
        </section>

        <section className="workspace" id="workspace">
          <div className="workspace-bar">
            <div className="workspace-status">
              <span className="status-light" />
              <span title={loadedFile?.name}>
                {loadedFile?.name ??
                  `WORKSPACE / ${
                    activeFlavor === "generic"
                      ? "UTF-8"
                      : activeFlavor.toUpperCase()
                  }`}
              </span>
            </div>
            <div className="quick-stats" aria-label="文本统计">
              <span>
                <strong>{source.length.toLocaleString("zh-CN")}</strong> 字符
              </span>
              <span>
                <strong>{lineCount.toLocaleString("zh-CN")}</strong> 行
              </span>
              <span>
                <strong>{locatedRange ? 1 : 0}</strong> 定位
              </span>
            </div>
          </div>

          <div className="panels">
            <article className="panel source-panel">
              <div className="panel-heading">
                <div>
                  <p className="panel-step">STEP 01</p>
                  <h2>源文本</h2>
                </div>
                <div className="panel-actions">
                  <button
                    className="ghost-button dark"
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                  >
                    <FileIcon />
                    文件
                  </button>
                  <button className="ghost-button dark" onClick={loadSample} type="button">
                    <SparkIcon />
                    默认
                  </button>
                  <button className="ghost-button dark" onClick={clearSource} type="button">
                    <TrashIcon />
                    清空
                  </button>
                </div>
              </div>

              <input
                accept={FILE_ACCEPT}
                className="file-input"
                onChange={(event) => {
                  const input = event.currentTarget;
                  void importFile(input.files?.[0] ?? null).finally(() => {
                    input.value = "";
                  });
                }}
                ref={fileInputRef}
                type="file"
              />
              {(loadedFile || fileNotice) && (
                <div className="file-status-shell">
                  {loadedFile && (
                    <div className="file-status">
                      <FileIcon />
                      <span className="file-extension">
                        {loadedFile.name.slice(
                          loadedFile.name.lastIndexOf(".") + 1,
                        )}
                      </span>
                      <strong>{loadedFile.name}</strong>
                      <small>{activeFlavor.toUpperCase()}</small>
                    </div>
                  )}
                  {fileNotice && (
                    <p className="import-notice" role="status">
                      {fileNotice}
                    </p>
                  )}
                </div>
              )}

              <div className="editor-shell">
                <SourceEditor
                  flavor={activeFlavor}
                  highlightRanges={locatedRange ? [locatedRange] : []}
                  onChange={handleSourceChange}
                  onLocateShortcut={generatePattern}
                  onSelectionChange={handleEditorSelection}
                  ref={editorRef}
                  value={source}
                />
              </div>

              <div className="selection-toolbar">
                <div
                  className={`selection-copy${
                    displaySelection ? " has-selection" : ""
                  }`}
                >
                  <span className="selection-icon">↗</span>
                  <div>
                    <span className="selection-label">
                      {displaySelection?.label ?? "尚未选择内容"}
                    </span>
                    <strong>
                      {displaySelection
                        ? displaySelection.text
                            .replace(/\s+/g, " ")
                            .slice(0, 54) +
                          (displaySelection.text.length > 54 ? "…" : "")
                        : "在左侧文本中拖选一段文字"}
                    </strong>
                  </div>
                </div>
                <div className="selection-count">
                  {displaySelection?.count ?? "0 字符"}
                </div>
              </div>
            </article>

            <article className="panel location-panel">
              <div className="panel-heading">
                <div>
                  <p className="panel-step">STEP 02</p>
                  <h2>变量定位</h2>
                </div>
              </div>

              <div className="generator">
                <button
                  className="generate-button"
                  disabled={!canGenerate}
                  onClick={generatePattern}
                  type="button"
                >
                  <SparkIcon />
                  关联选中内容并定位
                  <span className="button-key">Ctrl ↵</span>
                </button>
                {generationNote ? (
                  <p className="generation-note">
                    <span>✓</span>
                    {generationNote}
                  </p>
                ) : (
                  <p className="generation-note is-hint">
                    <span>i</span>
                    选中赋值行、变量名或值，右侧会自动关联对应变量。
                  </p>
                )}
              </div>

              {variableResult && (
                <div className="variable-context" aria-live="polite">
                  <div className="variable-context-heading">
                    <span>VARIABLE CONTEXT</span>
                    <span>
                      L{variableResult.line} · 定位{" "}
                      {locatedRange ? "已关联" : "未关联"}
                    </span>
                  </div>
                  <strong>
                    {variableResult.path.length > 0
                      ? `${variableResult.path.join(" › ")} › `
                      : ""}
                    {variableResult.variableName}
                  </strong>
                  <div className="variable-values">
                    <span>
                      <small>变量</small>
                      {variableResult.variableName}
                    </span>
                    <span>
                      <small>选中内容</small>
                      {locatedRange
                        ? source.slice(locatedRange.start, locatedRange.end)
                        : "—"}
                    </span>
                    <span>
                      <small>完整值</small>
                      {variableResult.value}
                    </span>
                    <span>
                      <small>单位</small>
                      {variableResult.unit ?? "—"}
                    </span>
                    {variableResult.contextValues.map((contextValue) => (
                      <span
                        className="context-value"
                        key={`${contextValue.line}-${contextValue.variableName}`}
                      >
                        <small>
                          {contextValue.variableName} · L{contextValue.line}
                        </small>
                        {contextValue.value}
                        {contextValue.unit ? ` ${contextValue.unit}` : ""}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="results-header">
                <div>
                  <h3>变量关联结果</h3>
                  <span>
                    {variableResult && locatedRange
                      ? "1 处 · 与选中内容关联"
                      : "等待选择"}
                  </span>
                </div>
                <div className="result-actions">
                  <button
                    aria-label="回到当前选中内容"
                    className="text-button"
                    disabled={!locatedRange}
                    onClick={locateSelection}
                    type="button"
                  >
                    <LocateIcon />
                    回到选中内容
                  </button>
                </div>
              </div>

              <div className="match-list">
                {(!variableResult || !locatedRange) && (
                  <div className="empty-state">
                    <span className="empty-glyph">VAR</span>
                    <strong>还没有变量定位</strong>
                    <p>在赋值行中划线选择任意内容，变量上下文会自动关联。</p>
                  </div>
                )}

                {variableResult && locatedRange && (
                  <button
                    className="match-item is-active"
                    onClick={locateSelection}
                    type="button"
                  >
                    <span className="match-index">01</span>
                    <span className="match-content">
                      <span className="match-meta">
                        <span>L{lineNumberAt(source, locatedRange.start)}</span>
                        <span>
                          列{" "}
                          {locatedRange.start -
                            source.lastIndexOf("\n", locatedRange.start - 1)}
                        </span>
                        <span>{variableResult.variableName}</span>
                      </span>
                      <strong>
                        {source.slice(locatedRange.start, locatedRange.end)}
                      </strong>
                      <small>{makeSnippet(source, variableResult)}</small>
                    </span>
                    <span className="match-jump">↗</span>
                  </button>
                )}

              </div>

              <div className="current-match" aria-live="polite">
                <div className="current-match-label">LOCATED SELECTION</div>
                {locatedRange ? (
                  <>
                    <code>{source.slice(locatedRange.start, locatedRange.end)}</code>
                    <span>
                      {locatedRange.start}–{locatedRange.end}
                    </span>
                  </>
                ) : (
                  <>
                    <code className="is-placeholder">等待选择变量行…</code>
                    <span>—</span>
                  </>
                )}
              </div>
            </article>
          </div>
        </section>

        <section className="quick-guide" aria-label="使用提示">
          <div className="guide-intro">
            <span>QUICK NOTES</span>
            <h2>从变量行到唯一路径。</h2>
          </div>
          <div className="guide-item">
            <span className="guide-number">A</span>
            <div>
              <strong>识别变量</strong>
              <p>读取变量名、当前值和单位，排除比较表达式与函数参数。</p>
            </div>
          </div>
          <div className="guide-item">
            <span className="guide-number">B</span>
            <div>
              <strong>结构定位</strong>
              <p>选区、代码块、属性及上游变量值共同关联到同一个变量。</p>
            </div>
          </div>
          <div className="guide-shortcut">
            <kbd>Ctrl</kbd>
            <span>+</span>
            <kbd>Enter</kbd>
            <small>定位变量值</small>
          </div>
        </section>
      </main>

      <footer>
        <span>Variable Studio</span>
        <p>变量解析与值定位 · 本地处理 · 无数据上传</p>
        <span>2026 / v0.1</span>
      </footer>
    </div>
  );
}

export default App;
