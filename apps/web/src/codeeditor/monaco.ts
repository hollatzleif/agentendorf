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
/** E240: in der Apple-Oberfläche eigene Themen (an die Farbstimmung von Xcode angelehnt, eigene Werte) */
export const APPLE_THEMA: Record<Thema, string> = { hell: 'apple-hell', dunkel: 'apple-dunkel' };
export const themaName = (t: Thema, apple: boolean) => (apple ? APPLE_THEMA : THEMA)[t];

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

monaco.editor.defineTheme('apple-hell', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: '', foreground: '1d1d1f' },
    { token: 'comment', foreground: '6c7986', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'a2328f', fontStyle: 'bold' },
    { token: 'string', foreground: 'c4261d' },
    { token: 'number', foreground: '2a1fcf' },
    { token: 'regexp', foreground: 'c4261d' },
    { token: 'type', foreground: '1b5f80' },
    { token: 'type.identifier', foreground: '1b5f80' },
    { token: 'tag', foreground: 'a2328f' },
    { token: 'attribute.name', foreground: '7f4fb0' },
    { token: 'delimiter', foreground: '1d1d1f' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#1d1d1f',
    'editorLineNumber.foreground': '#a6a6ad',
    'editorLineNumber.activeForeground': '#1d1d1f',
    'editor.lineHighlightBackground': '#eef4ff',
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': '#b3d6ff',
    'editor.inactiveSelectionBackground': '#dce6f5',
    'editorCursor.foreground': '#007aff',
    'editorIndentGuide.background1': '#ececf0',
    'editorWhitespace.foreground': '#d4d4d9',
    'editorWidget.background': '#f6f6f8',
    'editorWidget.border': '#d1d1d6',
    'editorSuggestWidget.selectedBackground': '#007aff',
    'editorSuggestWidget.selectedForeground': '#ffffff',
    'list.activeSelectionBackground': '#007aff',
    'list.activeSelectionForeground': '#ffffff',
    'minimap.background': '#fafafc',
    'scrollbarSlider.background': '#3c3c4333',
    'scrollbarSlider.hoverBackground': '#3c3c4355',
    'diffEditor.insertedTextBackground': '#34c75933',
    'diffEditor.removedTextBackground': '#ff3b3033',
    'focusBorder': '#007aff',
  },
});
monaco.editor.defineTheme('apple-dunkel', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'dedee3' },
    { token: 'comment', foreground: '7d8994', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'f562a5', fontStyle: 'bold' },
    { token: 'string', foreground: 'f36e5f' },
    { token: 'number', foreground: 'd2bf6b' },
    { token: 'regexp', foreground: 'f36e5f' },
    { token: 'type', foreground: '62d4fb' },
    { token: 'type.identifier', foreground: '62d4fb' },
    { token: 'tag', foreground: 'f562a5' },
    { token: 'attribute.name', foreground: 'b48ae8' },
    { token: 'delimiter', foreground: 'dedee3' },
  ],
  colors: {
    'editor.background': '#1e1e22',
    'editor.foreground': '#dedee3',
    'editorLineNumber.foreground': '#5f5f68',
    'editorLineNumber.activeForeground': '#dedee3',
    'editor.lineHighlightBackground': '#2a2b32',
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': '#3f5a86',
    'editor.inactiveSelectionBackground': '#33394a',
    'editorCursor.foreground': '#0a84ff',
    'editorIndentGuide.background1': '#2f3038',
    'editorWhitespace.foreground': '#3b3c44',
    'editorWidget.background': '#26272c',
    'editorWidget.border': '#3a3a40',
    'editorSuggestWidget.selectedBackground': '#0a84ff',
    'editorSuggestWidget.selectedForeground': '#ffffff',
    'list.activeSelectionBackground': '#0a84ff',
    'list.activeSelectionForeground': '#ffffff',
    'minimap.background': '#1b1b1f',
    'scrollbarSlider.background': '#ebebf533',
    'scrollbarSlider.hoverBackground': '#ebebf555',
    'diffEditor.insertedTextBackground': '#30d15833',
    'diffEditor.removedTextBackground': '#ff453a33',
    'focusBorder': '#0a84ff',
  },
});

/** Adresse eines Modells: ein Modell je Projektdatei (Sprache erkennt Monaco an der Endung) */
export const modellUri = (projekt: string, pfad: string, art = 'datei') => monaco.Uri.from({ scheme: 'dorf', authority: art, path: `/${projekt}/${pfad}` });

export { monaco };
