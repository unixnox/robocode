import { cpp } from '@codemirror/lang-cpp';
import { setDiagnostics, lintGutter, type Diagnostic } from '@codemirror/lint';
import { StateEffect, StateField } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { Decoration, type DecorationSet, keymap } from '@codemirror/view';
import { basicSetup, EditorView } from 'codemirror';

const setErrorLine = StateEffect.define<number | null>();
const errorLine = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setErrorLine)) {
        if (e.value === null) return Decoration.none;
        const line = tr.state.doc.line(Math.min(Math.max(1, e.value), tr.state.doc.lines));
        return Decoration.set([Decoration.line({ class: 'cm-error-line' }).range(line.from)]);
      }
    }
    return tr.docChanged ? Decoration.none : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export class CodeEditor {
  readonly view: EditorView;

  constructor(parent: HTMLElement, doc: string, onChange: (code: string) => void, onRun: () => void) {
    this.view = new EditorView({
      parent,
      doc,
      extensions: [
        basicSetup,
        cpp(),
        oneDark,
        lintGutter(),
        errorLine,
        keymap.of([{ key: 'Mod-Enter', run: () => { onRun(); return true; } }]),
        EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString()); }),
      ],
    });
  }

  get code() { return this.view.state.doc.toString(); }

  set code(text: string) {
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text } });
    this.clearErrors();
  }

  showError(line: number, col: number, message: string, kind: 'error' | 'warning' = 'error') {
    const doc = this.view.state.doc;
    const l = doc.line(Math.min(Math.max(1, line), doc.lines));
    const from = Math.min(l.from + Math.max(0, col - 1), l.to);
    const to = Math.min(l.to, from + 1) > from ? Math.min(l.to, from + 1) : l.to;
    const diag: Diagnostic = { from, to: Math.max(to, from), severity: kind, message };
    this.view.dispatch(setDiagnostics(this.view.state, [diag]));
    if (kind === 'error') {
      this.view.dispatch({ effects: [setErrorLine.of(line), EditorView.scrollIntoView(l.from, { y: 'center' })] });
    }
  }

  showWarnings(items: { line: number; message: string }[]) {
    const doc = this.view.state.doc;
    const diags = items.map((w) => {
      const l = doc.line(Math.min(Math.max(1, w.line), doc.lines));
      return { from: l.from, to: l.to, severity: 'warning' as const, message: w.message };
    });
    this.view.dispatch(setDiagnostics(this.view.state, diags));
  }

  clearErrors() {
    this.view.dispatch(setDiagnostics(this.view.state, []));
    this.view.dispatch({ effects: setErrorLine.of(null) });
  }
}
