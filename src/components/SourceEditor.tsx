import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import {
  Compartment,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  Decoration,
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";
import type { SourceFlavor, SourceRange } from "../lib/variables";

export interface SourceEditorHandle {
  focus: () => void;
  scrollToRange: (start: number, end: number) => void;
  selectRange: (start: number, end: number) => void;
}

interface SourceEditorProps {
  value: string;
  flavor: SourceFlavor;
  highlightRanges: SourceRange[];
  ariaLabel?: string;
  onChange: (value: string) => void;
  onSelectionChange: (range: SourceRange) => void;
  onLocateShortcut: () => void;
  onValueDoubleClick?: (position: number) => void;
}

const setHighlightRanges = StateEffect.define<SourceRange[]>();

const highlightField = StateField.define({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setHighlightRanges)) continue;
      const builder = new RangeSetBuilder<Decoration>();
      const length = transaction.state.doc.length;
      for (const range of effect.value) {
        const from = Math.max(0, Math.min(range.start, length));
        const to = Math.max(from, Math.min(range.end, length));
        if (from === to) continue;
        builder.add(
          from,
          to,
          Decoration.mark({
            class: "cm-variable-highlight",
          }),
        );
      }
      next = builder.finish();
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const editorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "#10231b",
      color: "#dbe6df",
    },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily: "var(--mono)",
      fontSize: "13px",
      lineHeight: "25px",
    },
    ".cm-content": {
      minHeight: "100%",
      padding: "20px 0 42px",
      caretColor: "#c9ef74",
    },
    ".cm-line": {
      padding: "0 22px",
    },
    ".cm-gutters": {
      minWidth: "48px",
      borderRight: "1px solid rgba(191, 214, 201, 0.11)",
      backgroundColor: "rgba(7, 24, 17, 0.3)",
      color: "#536e61",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      minWidth: "35px",
      padding: "0 13px 0 0",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(255, 255, 255, 0.025)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(201, 239, 116, 0.06)",
      color: "#c9ef74",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "rgba(103, 169, 224, 0.34)",
    },
    ".cm-variable-highlight": {
      borderRadius: "2px",
      backgroundColor: "#c9ef74",
      boxShadow: "0 0 0 1px #e9ffae, 0 0 13px rgba(201, 239, 116, 0.26)",
      color: "#10231b",
    },
    ".cm-placeholder": {
      color: "#71867b",
    },
  },
  { dark: true },
);

function languageFor(flavor: SourceFlavor) {
  return flavor === "python" || flavor === "workbench" ? python() : [];
}

const SourceEditor = forwardRef<SourceEditorHandle, SourceEditorProps>(
  function SourceEditor(
    {
      value,
      flavor,
      highlightRanges,
      ariaLabel = "源文本",
      onChange,
      onSelectionChange,
      onLocateShortcut,
      onValueDoubleClick,
    },
    forwardedRef,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const languageCompartment = useRef(new Compartment());
    const onChangeRef = useRef(onChange);
    const onSelectionChangeRef = useRef(onSelectionChange);
    const onLocateShortcutRef = useRef(onLocateShortcut);
    const onValueDoubleClickRef = useRef(onValueDoubleClick);
    const highlightKey = highlightRanges
      .map((range) => `${range.start}:${range.end}`)
      .join(",");

    onChangeRef.current = onChange;
    onSelectionChangeRef.current = onSelectionChange;
    onLocateShortcutRef.current = onLocateShortcut;
    onValueDoubleClickRef.current = onValueDoubleClick;

    useEffect(() => {
      if (!hostRef.current) return;

      const view = new EditorView({
        parent: hostRef.current,
        state: EditorState.create({
          doc: value,
          extensions: [
            lineNumbers(),
            highlightActiveLineGutter(),
            highlightActiveLine(),
            history(),
            drawSelection(),
            dropCursor(),
            EditorState.allowMultipleSelections.of(false),
            EditorState.tabSize.of(2),
            EditorView.lineWrapping,
            EditorView.contentAttributes.of({
              "aria-label": ariaLabel,
              spellcheck: "false",
            }),
            languageCompartment.current.of(languageFor(flavor)),
            highlightField,
            oneDark,
            editorTheme,
            placeholder("在这里粘贴任意文本，然后选中想定位的内容…"),
            EditorView.domEventHandlers({
              dblclick(event, view) {
                const position = view.posAtCoords({
                  x: event.clientX,
                  y: event.clientY,
                });
                if (position !== null) {
                  onValueDoubleClickRef.current?.(position);
                }
                return false;
              },
            }),
            keymap.of([
              {
                key: "Mod-Enter",
                run: () => {
                  onLocateShortcutRef.current();
                  return true;
                },
              },
              ...defaultKeymap,
              ...historyKeymap,
              indentWithTab,
            ]),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                onChangeRef.current(update.state.doc.toString());
              }
              if (update.selectionSet || update.docChanged) {
                const main = update.state.selection.main;
                onSelectionChangeRef.current({
                  start: Math.min(main.anchor, main.head),
                  end: Math.max(main.anchor, main.head),
                });
              }
            }),
          ],
        }),
      });
      viewRef.current = view;
      if (import.meta.env.DEV) {
        Object.defineProperty(hostRef.current, "__cmView", {
          configurable: true,
          value: view,
        });
      }

      return () => {
        view.destroy();
        viewRef.current = null;
      };
    }, []);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const currentValue = view.state.doc.toString();
      if (currentValue === value) return;
      view.dispatch({
        changes: { from: 0, to: currentValue.length, insert: value },
        selection: { anchor: 0 },
      });
    }, [value]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: languageCompartment.current.reconfigure(languageFor(flavor)),
      });
    }, [flavor]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: setHighlightRanges.of(highlightRanges),
      });
    }, [highlightKey]);

    useImperativeHandle(
      forwardedRef,
      () => ({
        focus() {
          viewRef.current?.focus();
        },
        scrollToRange(start, end) {
          const view = viewRef.current;
          if (!view) return;
          const from = Math.max(0, Math.min(start, view.state.doc.length));
          const to = Math.max(from, Math.min(end, view.state.doc.length));
          view.dispatch({
            effects: EditorView.scrollIntoView(from, {
              y: "center",
            }),
            scrollIntoView: true,
          });
          view.dispatch({
            effects: EditorView.scrollIntoView(to, {
              y: "nearest",
            }),
          });
        },
        selectRange(start, end) {
          const view = viewRef.current;
          if (!view) return;
          const from = Math.max(0, Math.min(start, view.state.doc.length));
          const to = Math.max(from, Math.min(end, view.state.doc.length));
          view.focus();
          view.dispatch({
            selection: { anchor: from, head: to },
            effects: EditorView.scrollIntoView(from, {
              y: "center",
            }),
            scrollIntoView: true,
          });
        },
      }),
      [],
    );

    return <div className="codemirror-host" ref={hostRef} />;
  },
);

export default SourceEditor;
