/**
 * Monaco (E197) – das Editor-Herz von VS Code (MIT), aus dem eigenen Build: keine CDN-Abhängigkeit, Worker und Sprachen
 * kommen als eigene Dateien vom Dorf (CSP: worker-src 'self' blob:, script-src 'self'). Dieses Modul wird nur von der
 * Editor-Seite geladen (lazy) – der Rest der App bleibt klein.
 */
import * as monaco from 'monaco-editor/editor';
import 'monaco-editor/features/register.all';
import 'monaco-editor/languages/definitions/register.all';
import { typescript } from 'monaco-editor/languages/features/register.all';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/languages/features/json/json.worker?worker';
import CssWorker from 'monaco-editor/languages/features/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/languages/features/html/html.worker?worker';
import TsWorker from 'monaco-editor/languages/features/typescript/ts.worker?worker';

(globalThis as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};

// TypeScript/JavaScript: Der Editor sieht immer nur einzelne Dateien, nie das ganze Projekt (node_modules, tsconfig) –
// eine echte Typprüfung würde jede import-Zeile rot unterstreichen. Darum nur Syntaxfehler; Typen prüft `tsc` im Terminal.
for (const d of [typescript.typescriptDefaults, typescript.javascriptDefaults]) {
  d.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
  d.setCompilerOptions({ ...d.getCompilerOptions(), jsx: typescript.JsxEmit.Preserve, allowJs: true, allowNonTsExtensions: true, target: typescript.ScriptTarget.ESNext });
}

export type Thema = 'hell' | 'dunkel';
export const THEMA: Record<Thema, string> = { hell: 'dorf-hell', dunkel: 'dorf-dunkel' };

// Hell: die Farben des Dorfs (helle Tafel, dunkelblaue Schrift, grüne Akzente); dunkel: dasselbe Blau als Grund
monaco.editor.defineTheme('dorf-hell', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6b7a67', fontStyle: 'italic' },
    { token: 'keyword', foreground: '2b3a55', fontStyle: 'bold' },
    { token: 'string', foreground: '2f8a2b' },
    { token: 'number', foreground: 'b85c00' },
    { token: 'type', foreground: '1d6fa5' },
  ],
  colors: {
    'editor.background': '#fffdf6',
    'editor.foreground': '#2b3a55',
    'editorLineNumber.foreground': '#a3acba',
    'editorLineNumber.activeForeground': '#2b3a55',
    'editor.lineHighlightBackground': '#f3f0e4',
    'editor.selectionBackground': '#cfe8c0',
    'editorCursor.foreground': '#e8761a',
    'editorIndentGuide.background1': '#e6e1d2',
    'editorWidget.background': '#fffdf6',
    'editorWidget.border': '#2b3a55',
    'minimap.background': '#faf7ec',
    'scrollbarSlider.background': '#2b3a5533',
    'diffEditor.insertedTextBackground': '#8ee06b55',
    'diffEditor.removedTextBackground': '#ff8a7a55',
  },
});
monaco.editor.defineTheme('dorf-dunkel', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '8a97ad', fontStyle: 'italic' },
    { token: 'string', foreground: '9fe07f' },
    { token: 'number', foreground: 'f2b51e' },
  ],
  colors: {
    'editor.background': '#1b2538',
    'editor.foreground': '#e8edf5',
    'editorLineNumber.foreground': '#5c6b85',
    'editorLineNumber.activeForeground': '#e8edf5',
    'editor.lineHighlightBackground': '#243049',
    'editor.selectionBackground': '#3d5a8a',
    'editorCursor.foreground': '#f2b51e',
    'editorWidget.background': '#243049',
    'minimap.background': '#182033',
  },
});

/** Adresse eines Modells: ein Modell je Projektdatei (Sprache erkennt Monaco an der Endung) */
export const modellUri = (projekt: string, pfad: string, art = 'datei') => monaco.Uri.from({ scheme: 'dorf', authority: art, path: `/${projekt}/${pfad}` });

export { monaco };
