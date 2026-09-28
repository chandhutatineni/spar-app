// Monaco, bundled locally (works offline), with its web workers built by Vite.
// Loaded lazily (see host.ts) so the editor's weight isn't on the startup path.

import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === "json") return new JsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new CssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new HtmlWorker();
    if (label === "typescript" || label === "javascript") return new TsWorker();
    return new EditorWorker();
  },
};

monaco.editor.defineTheme("spar-light", {
  base: "vs", inherit: true, rules: [],
  colors: { "editor.background": "#FFFFFF", "editorGutter.background": "#FFFFFF" },
});
monaco.editor.defineTheme("spar-dark", {
  base: "vs-dark", inherit: true, rules: [],
  colors: { "editor.background": "#1E1E1E", "editorGutter.background": "#1E1E1E" },
});

// Project files are checked by their own toolchains; don't flood the editor with
// "cannot find module" errors from a TypeScript service that can't see node_modules.
for (const d of [monaco.languages.typescript.typescriptDefaults, monaco.languages.typescript.javascriptDefaults]) {
  d.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
  d.setCompilerOptions({ jsx: monaco.languages.typescript.JsxEmit.Preserve, allowJs: true, allowNonTsExtensions: true, target: monaco.languages.typescript.ScriptTarget.ESNext });
}

export { monaco };
