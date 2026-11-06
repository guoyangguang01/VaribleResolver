import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import {
  Annotation,
  Compartment,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
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
import type { ResolvedTheme } from "../lib/theme";

export interface SourceEditorHandle {
  focus: () => void;
  scrollToRange: (start: number, end: number) => void;
  selectRange: (start: number, end: number) => void;
}

export interface EditorContextMenuRequest {
  x: number;
  y: number;
  range: SourceRange;
}

interface SourceEditorProps {
  value: string;
  flavor: SourceFlavor;
  highlightRanges: SourceRange[];
  theme: ResolvedTheme;
  ariaLabel?: string;
  onChange: (value: string) => void;
  onSelectionChange: (range: SourceRange) => void;
  onLocateShortcut: () => void;
  onValueDoubleClick?: (position: number) => void;
  onEditorContextMenu?: (request: EditorContextMenuRequest) => void;
}

const setHighlightRanges = StateEffect.define<SourceRange[]>();
const externalValueUpdate = Annotation.define<boolean>();

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

function editorTheme(theme: ResolvedTheme): Extension {
  const dark = theme === "dark";
  return EditorView.theme(
    {
      "&": {
        height: "100%",
        backgroundColor: dark ? "#14191f" : "#fbfcfe",
        color: dark ? "#e8ecf2" : "#253041",
      },
      ".cm-scroller": {
        overflow: "auto",
        fontFamily: "var(--font-mono)",
        fontSize: "12.5px",
        lineHeight: "23px",
      },
      ".cm-content": {
        minHeight: "100%",
        padding: "16px 0 36px",
        caretColor: dark ? "#8faed8" : "#345277",
      },
      ".cm-line": {
        padding: "0 18px",
      },
      ".cm-gutters": {
        minWidth: "46px",
        borderRight: `1px solid ${dark ? "#272e37" : "#e5e9ee"}`,
        backgroundColor: dark ? "#171c22" : "#f5f7fa",
        color: dark ? "#6f7b8b" : "#98a2b3",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        minWidth: "34px",
        padding: "0 12px 0 0",
      },
      ".cm-activeLine": {
        backgroundColor: dark
          ? "rgba(143, 174, 216, 0.06)"
          : "rgba(79, 107, 145, 0.055)",
      },
      ".cm-activeLineGutter": {
        backgroundColor: dark
          ? "rgba(143, 174, 216, 0.08)"
          : "rgba(79, 107, 145, 0.08)",
        color: dark ? "#a9c2e3" : "#345277",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
        backgroundColor: dark
          ? "rgba(116, 153, 201, 0.35)"
          : "rgba(95, 133, 184, 0.24)",
      },
      ".cm-variable-highlight": {
        borderRadius: "3px",
        backgroundColor: dark ? "#b8d1f3" : "#d8e7fb",
        boxShadow: `0 0 0 1px ${dark ? "#d7e7fb" : "#8fb2dc"}`,
        color: dark ? "#11161c" : "#1f3552",
      },
      ".cm-placeholder": {
        color: dark ? "#788596" : "#8a95a4",
      },
      ".cm-cursor": {
        borderLeftColor: dark ? "#b9d2f2" : "#345277",
      },
    },
    { dark },
  );
}

function editorThemeExtensions(theme: ResolvedTheme): Extension[] {
  return theme === "dark"
    ? [oneDark, editorTheme(theme)]
    : [editorTheme(theme)];
}

function languageFor(flavor: SourceFlavor) {
  return flavor === "python" || flavor === "workbench" ? python() : [];
}

const SourceEditor = forwardRef<SourceEditorHandle, SourceEditorProps>(
  function SourceEditor(
    {
      value,
      flavor,
      highlightRanges,
      theme,
      ariaLabel = "源文本",
      onChange,
      onSelectionChange,
      onLocateShortcut,
      onValueDoubleClick,
      onEditorContextMenu,
    },
    forwardedRef,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const languageCompartment = useRef(new Compartment());
    const themeCompartment = useRef(new Compartment());
    const onChangeRef = useRef(onChange);
    const onSelectionChangeRef = useRef(onSelectionChange);
    const onLocateShortcutRef = useRef(onLocateShortcut);
    const onValueDoubleClickRef = useRef(onValueDoubleClick);
    const onEditorContextMenuRef = useRef(onEditorContextMenu);
    const highlightKey = highlightRanges
      .map((range) => `${range.start}:${range.end}`)
      .join(",");

    onChangeRef.current = onChange;
    onSelectionChangeRef.current = onSelectionChange;
    onLocateShortcutRef.current = onLocateShortcut;
    onValueDoubleClickRef.current = onValueDoubleClick;
    onEditorContextMenuRef.current = onEditorContextMenu;

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
            themeCompartment.current.of(editorThemeExtensions(theme)),
            highlightField,
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
              contextmenu(event, view) {
                const position = view.posAtCoords({
                  x: event.clientX,
                  y: event.clientY,
                });
                const current = view.state.selection.main;
                if (
                  position !== null &&
                  (current.empty ||
                    position < current.from ||
                    position > current.to)
                ) {
                  view.dispatch({
                    selection: { anchor: position },
                  });
                }
                const selection = view.state.selection.main;
                event.preventDefault();
                onEditorContextMenuRef.current?.({
                  x: event.clientX,
                  y: event.clientY,
                  range: {
                    start: Math.min(selection.anchor, selection.head),
                    end: Math.max(selection.anchor, selection.head),
                  },
                });
                return true;
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
              if (
                update.docChanged &&
                !update.transactions.some((transaction) =>
                  transaction.annotation(externalValueUpdate),
                )
              ) {
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
        annotations: externalValueUpdate.of(true),
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
        effects: themeCompartment.current.reconfigure(
          editorThemeExtensions(theme),
        ),
      });
    }, [theme]);

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
